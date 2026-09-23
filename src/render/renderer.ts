import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { ForgeError } from '../errors.js';
import { log } from '../util/log.js';
import type { Theme } from '../theme/load.js';
import type { Frame } from './frame.js';
import { renderFrameHtml } from './html.js';
import { assetOrigin, isAssetUrl, lookupAsset } from './assets.js';

/** A measurement taken from the live DOM, used by `doctor`. */
export interface SlotProbe {
  slot: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rendered text, as the browser laid it out. */
  text: string;
  /** Computed colour, in `rgb()` form. */
  color: string;
  fontSize: number;
  lineHeight: number;
  /** Number of line boxes the text actually occupies. */
  lineCount: number;
  /** `true` when the content is pushed outside whatever clips it. */
  clipped: boolean;
  /** Computed `font-family` stack for the slot. */
  fontFamily: string;
  /**
   * Characters the requested webfont did not supply, so Chromium substituted
   * a system font for them. Empty in a healthy render.
   */
  missingGlyphs: string[];
}

export interface RenderedFrame {
  frame: Frame;
  png: Buffer;
  probes: SlotProbe[];
  /**
   * The same slide with every text slot hidden, captured only when asked for.
   *
   * Contrast has to be measured against what sits *behind* the type. Sampling
   * the finished slide instead measures the text against a mixture of the photo
   * and its own glyphs, so a dense headline drags its own score down and the
   * reading is really about ink coverage. Hiding the slots and re-shooting is
   * the only theme-agnostic way to see the backdrop.
   */
  backdrop?: Buffer;
}

export interface RendererOptions {
  /** Extra time in ms to wait for fonts/images. Rarely needed. */
  settleMs?: number;
}

export interface RenderFrameOptions {
  /** Also capture the slide with every text slot hidden. Used by `doctor`. */
  backdrop?: boolean;
}

/**
 * Chromium flags chosen so that the same input produces the same pixels on any
 * machine: fixed colour profile, no subpixel antialiasing, no font hinting.
 */
const DETERMINISTIC_ARGS = [
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
  '--disable-skia-runtime-opts',
  '--disable-font-subpixel-positioning',
  '--hide-scrollbars',
  '--mute-audio',
];

const PROBE_SCRIPT = () => {
  /** Nearest ancestor that would actually clip overflowing content. */
  const clipAncestor = (start: Element): Element | null => {
    let node: Element | null = start;
    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if (/hidden|clip|auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)) return node;
      node = node.parentElement;
    }
    return null;
  };

  /**
   * Characters the slot's own webfont does not supply.
   *
   * A missing glyph is invisible: Chromium silently substitutes a system font
   * per character, so the slide still looks like type and nothing anywhere
   * reports a problem. That is how a cache holding a subset with no latin
   * glyphs rendered every headline in a fallback serif without a word.
   *
   * `document.fonts.check()` cannot answer this — it returns true when *no*
   * face matches the family, which is precisely the failure being looked for.
   * So measure instead: a character is missing when its advance width is
   * identical to the fallback's with the webfont requested first. Two
   * different fallbacks are compared because a single one can coincide by
   * chance; matching both is not a coincidence.
   */
  const missingGlyphs = (familyStack: string, text: string): string[] => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    // Only the first family in the stack is the one the theme actually asked
    // for. Passing the whole stack would let the theme's own `serif` fallback
    // satisfy the measurement before the probe's fallback ever applied, and
    // the check would report a clean bill of health for every slide.
    const family = (familyStack || '').split(',')[0]?.trim() ?? '';
    if (!ctx || !family) return [];
    const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i;
    if (generic.test(family.replace(/^["']|["']$/g, ''))) return [];
    const width = (font: string, ch: string): number => {
      ctx.font = font;
      return ctx.measureText(ch).width;
    };
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const ch of text) {
      // Whitespace has no glyph to miss, and punctuation is too likely to
      // share an advance with the fallback to judge safely.
      if (seen.has(ch) || /\s/.test(ch)) continue;
      seen.add(ch);
      const mono = width(`40px monospace`, ch);
      const serif = width(`40px serif`, ch);
      const withMono = width(`40px ${family}, monospace`, ch);
      const withSerif = width(`40px ${family}, serif`, ch);
      if (withMono === mono && withSerif === serif && mono !== serif) missing.push(ch);
    }
    return missing;
  };

  /**
   * Smallest font size among the element's actual text runs. Probing the
   * wrapper would report its inherited size, which is usually not the size
   * anything is rendered at.
   */
  const textFontSize = (el: Element): number => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let smallest = Infinity;
    let node = walker.nextNode();
    while (node) {
      if ((node.textContent || '').trim().length > 0) {
        const parent = node.parentElement;
        if (parent) {
          const size = parseFloat(getComputedStyle(parent).fontSize) || 0;
          if (size > 0) smallest = Math.min(smallest, size);
        }
      }
      node = walker.nextNode();
    }
    return Number.isFinite(smallest) ? smallest : parseFloat(getComputedStyle(el).fontSize) || 0;
  };

  const out: Record<string, unknown>[] = [];
  for (const el of Array.from(document.querySelectorAll('[data-slot]'))) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const fontSize = textFontSize(el);
    let lineHeight = parseFloat(style.lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) lineHeight = fontSize * 1.2;

    const range = document.createRange();
    range.selectNodeContents(el);
    const boxes = Array.from(range.getClientRects()).filter((r) => r.height > 0.5);
    // Union of the text's own line boxes, which is what a reader actually sees.
    // Seeding this with the element's own box would defeat the point: a display
    // face with tight leading leaves a band of empty space inside the block
    // above the cap height, and measuring contrast there reports whatever the
    // photograph is doing behind no ink at all.
    const first = boxes[0];
    const content = boxes.reduce(
      (acc, r) => ({
        left: Math.min(acc.left, r.left),
        top: Math.min(acc.top, r.top),
        right: Math.max(acc.right, r.right),
        bottom: Math.max(acc.bottom, r.bottom),
      }),
      first
        ? { left: first.left, top: first.top, right: first.right, bottom: first.bottom }
        : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    );
    range.detach();

    let clipped = false;
    const clipper = clipAncestor(el);
    if (clipper) {
      const bounds = clipper.getBoundingClientRect();
      clipped =
        content.left < bounds.left - 2 ||
        content.top < bounds.top - 2 ||
        content.right > bounds.right + 2 ||
        content.bottom > bounds.bottom + 2;
    }

    out.push({
      slot: el.getAttribute('data-slot') || '',
      x: content.left,
      y: content.top,
      width: Math.max(0, content.right - content.left),
      height: Math.max(0, content.bottom - content.top),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      color: style.color,
      fontSize,
      lineHeight,
      lineCount:
        boxes.length > 0
          ? boxes.length
          : rect.height > 0
            ? Math.round(rect.height / lineHeight)
            : 0,
      clipped,
      fontFamily: style.fontFamily,
      missingGlyphs: missingGlyphs(
        style.fontFamily,
        (el.textContent || '').replace(/\s+/g, ' ').trim(),
      ),
    });
  }
  return out;
};

export class Renderer {
  private constructor(
    private readonly browser: Browser,
    private readonly settleMs: number,
  ) {}

  static async launch(options: RendererOptions = {}): Promise<Renderer> {
    let browser: Browser;
    try {
      browser = await chromium.launch({ args: DETERMINISTIC_ARGS });
    } catch (error) {
      throw new ForgeError(`Could not start Chromium: ${(error as Error).message}`, {
        hint: 'run `npx playwright install chromium` once to download the pinned browser build.',
      });
    }
    return new Renderer(browser, options.settleMs ?? 0);
  }

  /** The exact Chromium build in use. Reported by `doctor` for reproducibility. */
  version(): string {
    return this.browser.version();
  }

  private async withPage<T>(
    width: number,
    height: number,
    fn: (page: Page, served: Set<string>) => Promise<T>,
  ): Promise<T> {
    let context: BrowserContext | undefined;
    const served = new Set<string>();
    try {
      context = await this.browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        forcedColors: 'none',
        locale: 'en-US',
        timezoneId: 'UTC',
        offline: true,
      });
      const page = await context.newPage();
      await page.route(`${assetOrigin()}/**`, async (route) => {
        const url = route.request().url();
        const asset = lookupAsset(url);
        if (!asset) {
          await route.abort('failed');
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: asset.mime,
          body: asset.bytes,
          headers: { 'cache-control': 'no-store' },
        });
        served.add(url);
      });
      return await fn(page, served);
    } finally {
      await context?.close();
    }
  }

  async render(
    frame: Frame,
    theme: Theme,
    fontCss: string,
    options?: RenderFrameOptions,
  ): Promise<RenderedFrame> {
    const html = renderFrameHtml({ frame, theme, fontCss });
    const { w, h } = frame.context.canvas;

    return this.withPage(w, h, async (page, served) => {
      await page.setContent(html, { waitUntil: 'load' });

      // `document.fonts.ready` alone is not enough. It resolves as soon as the
      // document has no *pending* font loads, and a face is only requested once
      // layout asks for it. On a fast machine the styled text has already been
      // laid out by `load` and everything works; on a loaded CI runner the
      // promise can resolve before any face has been requested, the screenshot
      // catches fallback glyphs, and the next build - identical inputs - wins
      // the race and produces different pixels. Force every declared face to
      // load first, then wait.
      const unresolved = await page.evaluate(async () => {
        interface DeclaredFace {
          family: string;
          weight: string;
          style: string;
          status: string;
          load(): Promise<unknown>;
        }
        const declared = (): DeclaredFace[] => {
          const out: DeclaredFace[] = [];
          // `forEach` rather than `Array.from`: FontFaceSet is only iterable
          // under lib.dom.iterable, which this package does not enable.
          document.fonts.forEach((face) => out.push(face as unknown as DeclaredFace));
          return out;
        };
        await Promise.all(
          declared().map(async (face) => {
            try {
              await face.load();
            } catch {
              /* reported below via its status */
            }
          }),
        );
        await document.fonts.ready;
        return declared()
          .filter((face) => face.status !== 'loaded')
          .map((face) => `${face.family} ${face.weight} ${face.style}`);
      });
      if (unresolved.length > 0) {
        log.warn(
          `These faces never loaded and will render as a system fallback: ${unresolved.join(', ')}. ` +
            'Output from this build will not match a machine where they load.',
        );
      }
      await page.evaluate(async () => {
        const images = Array.from(document.images);
        await Promise.all(
          images.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                }),
          ),
        );
      });
      if (this.settleMs > 0) await page.waitForTimeout(this.settleMs);

      // A photo that never painted is the single most damaging silent failure
      // this renderer can have: the slide still looks plausible, just empty.
      // Only URLs the theme actually references are checked — a layout is free
      // to ignore the slide's photo.
      const referenced = (await page.evaluate(() => {
        const urls = new Set<string>();
        const collect = (value: string) => {
          for (const match of value.matchAll(/url\("?([^")]+)"?\)/g)) {
            if (match[1]) urls.add(match[1]);
          }
        };
        for (const el of Array.from(document.querySelectorAll('*'))) {
          const style = getComputedStyle(el);
          collect(style.backgroundImage);
          collect(style.borderImageSource);
          for (const pseudo of ['::before', '::after']) {
            const ps = getComputedStyle(el, pseudo);
            collect(ps.backgroundImage);
            collect(ps.content);
          }
        }
        for (const img of Array.from(document.images)) {
          if (img.currentSrc || img.src) urls.add(img.currentSrc || img.src);
        }
        return Array.from(urls);
      })) as unknown as string[];

      const missing = referenced.filter((url) => isAssetUrl(url) && !served.has(url));
      if (missing.length > 0) {
        throw new ForgeError(
          `An image on slide ${frame.slideNumber} was referenced but never loaded.`,
          {
            where: `with theme "${theme.manifest.name}"`,
            hint: 'this is a bug in carousel-forge, not in your project — please report it with the image that triggered it.',
          },
        );
      }

      // `load` and `document.images` between them say nothing about CSS
      // background images, which is what every theme actually uses for the
      // photograph. Decode each one explicitly and let two frames pass, or the
      // screenshot races the first paint and the export stops being
      // reproducible.
      await page.evaluate(async (urls: string[]) => {
        await Promise.all(
          urls.map(
            (url) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  void img.decode().then(
                    () => resolve(),
                    () => resolve(),
                  );
                };
                img.onerror = () => resolve();
                img.src = url;
              }),
          ),
        );
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      }, referenced.filter(isAssetUrl));

      const probes = (await page.evaluate(PROBE_SCRIPT)) as unknown as SlotProbe[];
      const raw = await page.screenshot({
        type: 'png',
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
        clip: { x: 0, y: 0, width: w, height: h },
      });

      // Re-encode so no browser-supplied ancillary chunks reach the file.
      const png = await sharp(raw).png({ compressionLevel: 9, effort: 7 }).toBuffer();

      let backdrop: Buffer | undefined;
      if (options?.backdrop) {
        // Drop the ink, keep the boxes. `visibility: hidden` would also remove
        // anything the theme paints *on* the slot — a label's dark lozenge, a
        // highlight block behind a word — and those exist precisely to make the
        // text legible, so hiding them invents failures. Making the glyphs
        // transparent leaves every backdrop the reader actually sees in place
        // and keeps the probe rectangles valid against this second capture.
        await page.evaluate(() => {
          const style = document.createElement('style');
          style.textContent =
            '[data-slot], [data-slot] * { color: transparent !important;' +
            ' text-shadow: none !important; }';
          document.head.append(style);
        });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            }),
        );
        const bare = await page.screenshot({
          type: 'png',
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
          clip: { x: 0, y: 0, width: w, height: h },
        });
        backdrop = await sharp(bare).png({ compressionLevel: 9, effort: 7 }).toBuffer();
      }

      return { frame, png, probes, backdrop };
    });
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
