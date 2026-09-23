import path from 'node:path';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { ForgeError } from '../errors.js';
import { displayPath, pathExists, sha256 } from '../util/fs.js';
import { coverCrop, coverScale, type CropRect, type Size } from './crop.js';
import { registerAsset } from '../render/assets.js';

export interface LuminanceBands {
  /** Mean relative luminance of the top 22% of the cropped photo. */
  top: number;
  /** ...of the middle band, y 30%–70%. */
  mid: number;
  /** ...of the bottom 38%, where most themes set their copy. */
  bottom: number;
  /** ...of the whole frame. */
  all: number;
  /**
   * Mean luminance per cell of a 4-row by 3-column grid, row-major.
   *
   * Bands alone are too coarse: a dark band average hides a bright storefront
   * sitting directly behind a line of type. Themes pick the cells their copy
   * actually covers.
   */
  cells: number[];
  /**
   * Luminance standard deviation per cell, same order as `cells`.
   *
   * Mean brightness is only half the legibility story — small type over a
   * busy, high-frequency background is hard to read even when the average
   * contrast is fine. Themes can fold this into their scrim curve.
   */
  variance: number[];
}

export interface PreparedImage {
  /**
   * URL the page should reference. Served from memory by the renderer rather
   * than inlined, because Chromium silently drops `data:` URLs over 2 MB.
   */
  url: string;
  /** `data:` URI of the same bytes. Convenient for embedding elsewhere. */
  dataUri: string;
  /** Raw PNG bytes behind the URL, kept for pixel sampling in `doctor`. */
  buffer: Buffer;
  /**
   * How bright the photo is, by band. Exposed to themes as custom properties
   * so a theme can deepen its own scrim over a high-key photograph. Core
   * measures; the theme decides what to do about it.
   */
  luminance: LuminanceBands;
  source: Size;
  target: Size;
  crop: CropRect;
  /** Below 1 means the source had to be upscaled to fill the canvas. */
  scale: number;
  file: string;
}

const MIME_BY_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
};

export function resolveAsset(reference: string, baseDir: string): string {
  return path.isAbsolute(reference) ? reference : path.resolve(baseDir, reference);
}

export async function assertAssetExists(
  reference: string,
  baseDir: string,
  what: string,
): Promise<string> {
  const absolute = resolveAsset(reference, baseDir);
  if (!(await pathExists(absolute))) {
    throw new ForgeError(`${what} not found: ${reference}`, {
      hint: `looked in ${displayPath(path.dirname(absolute))}. Paths are relative to the carousel file.`,
    });
  }
  return absolute;
}

/** Inline any file as a data URI without touching its pixels. */
export async function inlineAsset(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const bytes = await fs.readFile(file);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/**
 * Serve any file to the page by URL without touching its pixels. Used for
 * logos, which can be SVG or a large PNG.
 */
export async function assetUrl(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const bytes = await fs.readFile(file);
  return registerAsset(bytes, mime);
}

const cache = new Map<string, PreparedImage>();

/**
 * Crop a photo around its focal point and resize it to exactly the target box.
 *
 * Doing this with sharp rather than letting CSS `object-fit` handle it keeps
 * the output independent of the browser's scaling implementation, which is a
 * prerequisite for byte-identical renders across machines.
 */
export async function prepareImage(options: {
  file: string;
  target: Size;
  focal?: readonly [number, number];
}): Promise<PreparedImage> {
  const { file, target } = options;
  const focal = options.focal ?? [0.5, 0.5];

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(file);
  } catch {
    throw new ForgeError(`Image not found: ${displayPath(file)}`);
  }

  const key = sha256(
    [file, stat.size, stat.mtimeMs, target.w, target.h, focal[0], focal[1]].join('|'),
  );
  const cached = cache.get(key);
  if (cached) return cached;

  const input = sharp(file, { failOn: 'error' });
  const metadata = await input.metadata();
  const sourceW = metadata.width ?? 0;
  const sourceH = metadata.height ?? 0;
  if (!sourceW || !sourceH) {
    throw new ForgeError(`Could not read the dimensions of ${displayPath(file)}.`, {
      hint: 'is the file a valid image? SVG sources need an explicit width and height.',
    });
  }

  const source: Size = { w: sourceW, h: sourceH };
  const crop = coverCrop(source, target, focal);

  const buffer = await sharp(file, { failOn: 'error' })
    .rotate()
    .extract({ left: crop.left, top: crop.top, width: crop.width, height: crop.height })
    .resize(target.w, target.h, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, effort: 7, palette: false })
    .toBuffer();

  const prepared: PreparedImage = {
    url: registerAsset(buffer, 'image/png'),
    dataUri: `data:image/png;base64,${buffer.toString('base64')}`,
    buffer,
    luminance: await luminanceBands(buffer),
    source,
    target,
    crop,
    scale: coverScale(source, target),
    file,
  };
  cache.set(key, prepared);
  return prepared;
}

export function clearImageCache(): void {
  cache.clear();
}

/** Thumbnail width used for luminance sampling. Small, but enough for bands. */
const LUMA_W = 96;

/** Luminance grid resolution. Rows are horizontal slices, top to bottom. */
export const LUMA_ROWS = 4;
export const LUMA_COLS = 3;

/**
 * Average brightness of the photo, by band and by grid cell.
 *
 * Sampled from a small thumbnail rather than the full frame: it is two orders
 * of magnitude cheaper, still representative of an area average, and — because
 * sharp's resize is deterministic — produces the same numbers everywhere.
 * Rounded so the value serialised into CSS never drifts.
 */
export async function luminanceBands(png: Buffer): Promise<LuminanceBands> {
  const { data, info } = await sharp(png)
    .resize(LUMA_W, null, { kernel: 'lanczos3' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  const luma = (x: number, y: number): number => {
    const i = (y * width + x) * channels;
    return relativeLuminance(
      (data[i] ?? 0) / 255,
      (data[i + 1] ?? 0) / 255,
      (data[i + 2] ?? 0) / 255,
    );
  };

  const rowLuma: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let total = 0;
    for (let x = 0; x < width; x += 1) total += luma(x, y);
    rowLuma.push(total / width);
  }

  const band = (from: number, to: number): number => {
    const a = Math.max(0, Math.min(height - 1, Math.floor(from * height)));
    const b = Math.max(a + 1, Math.min(height, Math.ceil(to * height)));
    let total = 0;
    for (let y = a; y < b; y += 1) total += rowLuma[y] ?? 0;
    return round4(total / (b - a));
  };

  const cells: number[] = [];
  const variance: number[] = [];
  for (let r = 0; r < LUMA_ROWS; r += 1) {
    const y0 = Math.floor((r / LUMA_ROWS) * height);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) / LUMA_ROWS) * height));
    for (let c = 0; c < LUMA_COLS; c += 1) {
      const x0 = Math.floor((c / LUMA_COLS) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) / LUMA_COLS) * width));
      const samples: number[] = [];
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) samples.push(luma(x, y));
      }
      const mean = samples.reduce((a, b) => a + b, 0) / (samples.length || 1);
      const sd = Math.sqrt(
        samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length || 1),
      );
      cells.push(round4(mean));
      variance.push(round4(sd));
    }
  }

  return {
    top: band(0, 0.22),
    mid: band(0.3, 0.7),
    bottom: band(0.62, 1),
    all: band(0, 1),
    cells,
    variance,
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Mean relative luminance (0 = black, 1 = white) of a rectangle of a PNG.
 * Used by the contrast check, which needs to know how bright the photo is
 * behind a piece of text.
 */
export async function meanLuminance(png: Buffer, rect: Rect): Promise<number> {
  const image = sharp(png);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return 0.5;

  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(width - left, Math.round(rect.width)));
  const h = Math.max(1, Math.min(height - top, Math.round(rect.height)));

  const { data, info } = await image
    .extract({ left, top, width: w, height: h })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  let total = 0;
  let count = 0;
  for (let i = 0; i + channels - 1 < data.length; i += channels) {
    const r = (data[i] ?? 0) / 255;
    const g = (data[i + 1] ?? 0) / 255;
    const b = (data[i + 2] ?? 0) / 255;
    total += relativeLuminance(r, g, b);
    count += 1;
  }
  return count > 0 ? total / count : 0.5;
}

/**
 * Relative luminance of each cell of a grid laid over a rectangle of a PNG.
 *
 * The mean over a whole text box is not good enough to judge legibility. A
 * backlit photograph — blown-out sky on one side, dark trees on the other —
 * averages out to a comfortable mid-grey while the words sitting on the bright
 * half are unreadable. Averaging is blindest exactly where the check matters
 * most, so callers look at the worst cell instead.
 */
export async function patchLuminances(png: Buffer, rect: Rect, grid = 8): Promise<number[]> {
  const image = sharp(png);
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return [];

  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(width - left, Math.round(rect.width)));
  const h = Math.max(1, Math.min(height - top, Math.round(rect.height)));

  const { data, info } = await image
    .extract({ left, top, width: w, height: h })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Keep cells big enough to mean something. A handful of pixels of antialiased
  // edge is not a legibility problem, so do not let the grid outrun the box.
  const cols = Math.max(1, Math.min(grid, Math.floor(info.width / 24)));
  const rows = Math.max(1, Math.min(grid, Math.floor(info.height / 12)));
  const sums = new Float64Array(rows * cols);
  const counts = new Float64Array(rows * cols);
  const channels = info.channels;

  for (let y = 0; y < info.height; y += 1) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / info.height));
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * channels;
      const l = relativeLuminance(
        (data[i] ?? 0) / 255,
        (data[i + 1] ?? 0) / 255,
        (data[i + 2] ?? 0) / 255,
      );
      const cx = Math.min(cols - 1, Math.floor((x * cols) / info.width));
      const cell = cy * cols + cx;
      sums[cell] = (sums[cell] ?? 0) + l;
      counts[cell] = (counts[cell] ?? 0) + 1;
    }
  }

  const out: number[] = [];
  for (let i = 0; i < sums.length; i += 1) {
    if ((counts[i] ?? 0) > 0) out.push((sums[i] ?? 0) / (counts[i] ?? 1));
  }
  return out;
}

function channelLinear(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance from sRGB channels in the 0..1 range. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

/** WCAG contrast ratio between two relative luminances, 1..21. */
export function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Parse `rgb()` / `rgba()` / `color(srgb …)` / `#rrggbb` into 0..1 channels. */
export function parseCssColor(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(trimmed);
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  }
  // Chromium serialises `color-mix(in srgb, …)` — which themes use to adapt a
  // colour to the photograph — as `color(srgb r g b)`, with channels already
  // in 0..1. Failing to parse it here does not raise a warning, it removes
  // one: the caller reads null as "no colour to judge" and skips the contrast
  // check for that slot entirely. warm-editorial's slide number is exactly
  // such a slot, so it went unchecked until this was added.
  const srgb = /^color\(\s*srgb\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/i.exec(trimmed);
  if (srgb) {
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    return [clamp(Number(srgb[1])), clamp(Number(srgb[2])), clamp(Number(srgb[3]))];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const digits = hex[1] as string;
    const full =
      digits.length === 3
        ? digits
            .split('')
            .map((c) => c + c)
            .join('')
        : digits;
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
    ];
  }
  return null;
}
