import path from 'node:path';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { ForgeError } from '../errors.js';
import { displayPath, pathExists, sha256 } from '../util/fs.js';
import { coverCrop, coverScale, type CropRect, type Size } from './crop.js';

export interface PreparedImage {
  /** `data:` URI of the cropped, exactly sized image. */
  dataUri: string;
  /** Raw PNG bytes behind the data URI, kept for pixel sampling in `doctor`. */
  buffer: Buffer;
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

/** Inline any file as a data URI without touching its pixels. Used for logos. */
export async function inlineAsset(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const bytes = await fs.readFile(file);
  return `data:${mime};base64,${bytes.toString('base64')}`;
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
    dataUri: `data:image/png;base64,${buffer.toString('base64')}`,
    buffer,
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

/** Parse `rgb()` / `rgba()` / `#rrggbb` into 0..1 channels. */
export function parseCssColor(value: string): [number, number, number] | null {
  const trimmed = value.trim();
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(trimmed);
  if (rgb) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
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
