import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { ForgeError } from '../errors.js';
import type { Theme } from '../theme/load.js';
import type { Frame } from './frame.js';
import { renderFrameHtml } from './html.js';

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
  /** `true` for slots the audience is meant to read, as opposed to chrome. */
  readable: boolean;
}

export interface RenderedFrame {
  frame: Frame;
  png: Buffer;
  probes: SlotProbe[];
}

export interface RendererOptions {
  /** Extra time in ms to wait for fonts/images. Rarely needed. */
  settleMs?: number;
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
  const READABLE = new Set(['title', 'body', 'bullets', 'cta', 'eyebrow']);

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
    const content = boxes.reduce(
      (acc, r) => ({
        left: Math.min(acc.left, r.left),
        top: Math.min(acc.top, r.top),
        right: Math.max(acc.right, r.right),
        bottom: Math.max(acc.bottom, r.bottom),
      }),
      { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
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
        boxes.length > 0 ? boxes.length : rect.height > 0 ? Math.round(rect.height / lineHeight) : 0,
      clipped,
      readable: READABLE.has(el.getAttribute('data-slot') || ''),
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
    fn: (page: Page) => Promise<T>,
  ): Promise<T> {
    let context: BrowserContext | undefined;
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
      return await fn(page);
    } finally {
      await context?.close();
    }
  }

  async render(frame: Frame, theme: Theme, fontCss: string): Promise<RenderedFrame> {
    const html = renderFrameHtml({ frame, theme, fontCss });
    const { w, h } = frame.context.canvas;

    return this.withPage(w, h, async (page) => {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
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
      return { frame, png, probes };
    });
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
