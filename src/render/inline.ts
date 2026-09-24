import sharp from 'sharp';
import { ForgeError } from '../errors.js';
import { assetOrigin, lookupAsset } from './assets.js';

/**
 * Turn the output of `renderFrameHtml` into a self-contained document.
 *
 * `build` serves photographs over an in-memory origin (see `assets.ts`) and
 * never needs this. Anything that wants to *show* a frame in an ordinary
 * browser context — a live preview inside an editor, a saved .html, a
 * screenshot harness — has no way to fulfil those requests and has to inline
 * the bytes instead. That step used to belong to the embedder, and every
 * embedder that wrote it hit the same silent failure, so it lives here now.
 *
 * ## The failure this exists to prevent
 *
 * Themes paint the photograph through a custom property:
 *
 * ```css
 * background-image: var(--image);
 * ```
 *
 * Chromium **silently discards a custom property whose value runs past roughly
 * 2 MB** while accepting the identical URL in a direct `background-image`
 * declaration. Nothing is logged and no rule reports an error — the element
 * simply paints its background colour, so a preview shows a black rectangle
 * exactly where the photograph belongs while `build` produces a perfect PNG.
 *
 * Measured on Chromium 131 (Windows on ARM), a data URI of the given size
 * applied both ways:
 *
 * | size    | via `var(--image)` | direct `background-image` |
 * | ------- | ------------------ | ------------------------- |
 * | 1024 KB | paints             | paints                    |
 * | 1536 KB | paints             | paints                    |
 * | 2048 KB | **dropped**        | paints                    |
 * | 2560 KB | **dropped**        | paints                    |
 *
 * A cropped 1080x1350 photograph is routinely 2–4 MB as PNG, so this is the
 * normal case, not an edge one. A synthetic gradient would never reveal it:
 * flat colour compresses to a few kilobytes and sails under the limit.
 *
 * ## What this does about it
 *
 * Assets are inlined byte-for-byte whenever they fit. A raster image whose
 * data URI would cross {@link CUSTOM_PROPERTY_CEILING} is re-encoded as JPEG
 * instead — lossy, and deliberately so: the alternative is showing nothing at
 * all. Moving the photo out of the custom property would have worked too, but
 * only by changing what themes are allowed to assume, and every theme that
 * exists today reads `var(--image)`.
 *
 * **The result is for viewing, not for shipping.** It is not byte-identical to
 * what `build` renders, and it is not covered by the determinism guarantee.
 * Render the real slides with `build`.
 */

/**
 * Data URI size, in bytes, above which a raster image gets re-encoded.
 *
 * Set well under the observed ~2 MB cliff rather than against it: the limit is
 * an implementation detail of one browser version, it is measured against the
 * whole declaration rather than just the URL, and there is nothing to be
 * gained by sitting close to an edge that fails silently.
 */
export const CUSTOM_PROPERTY_CEILING = 1_500_000;

/**
 * How a photo over the ceiling is shrunk, in order, until one fits.
 *
 * Quality alone does not bound the output. The noise fixture in
 * `tests/inline.test.ts` — deliberately incompressible — still encodes to
 * 1.7 MB at quality 58, so the ladder has to be able to give up resolution
 * too. Nothing here is negotiable at runtime: the same input has to produce
 * the same preview on every machine.
 *
 * A preview is displayed at a fraction of canvas size, so the last rungs cost
 * far less on screen than the numbers suggest. `build` is untouched either
 * way.
 */
const LADDER = [
  { scale: 1, quality: 82 },
  { scale: 1, quality: 70 },
  { scale: 1, quality: 58 },
  { scale: 0.75, quality: 70 },
  { scale: 0.5, quality: 70 },
  { scale: 0.35, quality: 60 },
] as const;

/** Formats worth re-encoding. SVG is text and stays text; GIF may animate. */
const RECODABLE = new Set(['image/png', 'image/webp', 'image/avif', 'image/tiff']);

export interface InlineFrameAssetsOptions {
  /** Override {@link CUSTOM_PROPERTY_CEILING}. Mostly here for tests. */
  maxDataUriBytes?: number;
}

/** Every distinct asset URL the document references, in first-seen order. */
function assetUrlsIn(html: string): string[] {
  const origin = assetOrigin().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${origin}/[0-9a-f]{64}\\.[a-z0-9]+`, 'g');
  return [...new Set(html.match(pattern) ?? [])];
}

function toDataUri(bytes: Buffer, mime: string): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/**
 * Shrink one image until its data URI fits under `ceiling`, or give up and
 * return the smallest attempt. Giving up still beats the original: a soft
 * photograph that paints is worth more than a perfect one that does not.
 */
async function fitUnderCeiling(bytes: Buffer, ceiling: number): Promise<string> {
  const width = (await sharp(bytes).metadata()).width ?? 0;
  let smallest: string | undefined;

  for (const { scale, quality } of LADDER) {
    let pipeline = sharp(bytes).flatten({ background: '#000000' });
    if (scale < 1 && width > 0) {
      pipeline = pipeline.resize({ width: Math.max(1, Math.round(width * scale)) });
    }
    const uri = toDataUri(
      await pipeline.jpeg({ quality, chromaSubsampling: '4:4:4' }).toBuffer(),
      'image/jpeg',
    );
    if (uri.length <= ceiling) return uri;
    if (smallest === undefined || uri.length < smallest.length) smallest = uri;
  }

  return smallest as string;
}

/**
 * Replace every in-memory asset URL in a frame document with inline bytes.
 *
 * Assets live in the process that rendered the frame, so this has to run there
 * too — pass the HTML straight from `renderFrameHtml`, in the same process,
 * before `clearAssets()`.
 */
export async function inlineFrameAssets(
  html: string,
  options: InlineFrameAssetsOptions = {},
): Promise<string> {
  const ceiling = options.maxDataUriBytes ?? CUSTOM_PROPERTY_CEILING;
  let out = html;

  for (const url of assetUrlsIn(html)) {
    const asset = lookupAsset(url);
    if (!asset) {
      throw new ForgeError(`No asset is registered for ${url}.`, {
        hint:
          'assets are held in memory by the process that rendered the frame. Inline the ' +
          'HTML in that same process, before clearAssets().',
      });
    }

    const verbatim = toDataUri(asset.bytes, asset.mime);
    const inlined =
      verbatim.length > ceiling && RECODABLE.has(asset.mime)
        ? await fitUnderCeiling(asset.bytes, ceiling)
        : verbatim;

    out = out.split(url).join(inlined);
  }

  return out;
}
