import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDir, listFiles, pathExists } from '../util/fs.js';
import { log } from '../util/log.js';
import type { FontRequest } from '../theme/schema.js';

/**
 * Fonts are downloaded once into a local cache and then inlined into the page
 * as base64 `@font-face` sources. After the first run the renderer never
 * touches the network, which is what makes the output deterministic.
 */
export function fontCacheDir(): string {
  const override = process.env.CAROUSEL_FORGE_CACHE;
  if (override) return path.join(override, 'fonts');
  const base =
    process.platform === 'win32'
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
      : process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'carousel-forge', 'fonts');
}

export interface FontFace {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** Absolute path of the cached woff2 file. */
  file: string;
}

function slug(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function cacheFileFor(family: string, weight: number, style: string): string {
  return path.join(fontCacheDir(), `${slug(family)}-${weight}-${style}.woff2`);
}

/** A modern UA is required or the CSS API answers with legacy ttf sources. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function css2Url(request: FontRequest): string {
  const italics = request.styles.includes('italic');
  const weights = [...new Set(request.weights)].sort((a, b) => a - b);
  const family = request.family.replace(/ /g, '+');
  const spec = italics
    ? `ital,wght@${weights.map((w) => `0,${w}`).join(';')};${weights.map((w) => `1,${w}`).join(';')}`
    : `wght@${weights.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${family}:${spec}&display=block`;
}

interface ParsedFace {
  weight: number;
  style: 'normal' | 'italic';
  url: string;
}

/** Pull `@font-face` blocks out of a Google Fonts CSS payload. */
export function parseGoogleCss(css: string): ParsedFace[] {
  const faces: ParsedFace[] = [];
  const blocks = css.split('@font-face').slice(1);
  for (const block of blocks) {
    const url = /src:\s*url\(([^)]+)\)/.exec(block)?.[1];
    if (!url) continue;
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1] ?? '400');
    const style = /font-style:\s*italic/.test(block) ? 'italic' : 'normal';
    faces.push({ weight, style, url: url.replace(/['"]/g, '') });
  }
  return faces;
}

async function download(url: string, init?: RequestInit): Promise<Buffer> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Ensure every requested family/weight/style is present in the cache.
 * Returns the faces that are available; anything that could not be fetched is
 * reported and skipped so a build never hard-fails on a network hiccup.
 */
export async function ensureGoogleFonts(requests: FontRequest[]): Promise<FontFace[]> {
  const available: FontFace[] = [];
  const missing: FontRequest[] = [];

  for (const request of requests) {
    const wanted: FontFace[] = [];
    for (const weight of request.weights) {
      for (const style of request.styles) {
        wanted.push({
          family: request.family,
          weight,
          style,
          file: cacheFileFor(request.family, weight, style),
        });
      }
    }
    const absent = [];
    for (const face of wanted) {
      if (await pathExists(face.file)) available.push(face);
      else absent.push(face);
    }
    if (absent.length > 0) missing.push(request);
  }

  if (missing.length === 0) return available;

  await ensureDir(fontCacheDir());
  for (const request of missing) {
    try {
      const css = await download(css2Url(request), {
        headers: { 'User-Agent': UA },
      }).then((b) => b.toString('utf8'));

      for (const face of parseGoogleCss(css)) {
        if (!request.weights.includes(face.weight)) continue;
        if (!request.styles.includes(face.style)) continue;
        const file = cacheFileFor(request.family, face.weight, face.style);
        if (await pathExists(file)) continue;
        await fs.writeFile(file, await download(face.url));
        available.push({ family: request.family, weight: face.weight, style: face.style, file });
      }
    } catch (error) {
      log.warn(
        `Could not download "${request.family}" (${(error as Error).message}). ` +
          'Rendering will fall back to a system font, so the output may differ from a machine that has the font cached.',
      );
    }
  }

  // De-duplicate: a face may have been counted both as cached and as fetched.
  const unique = new Map(available.map((f) => [`${f.family}|${f.weight}|${f.style}`, f]));
  return [...unique.values()];
}

/** Read any font files a theme ships in its own `fonts/` directory. */
export async function themeFontFaces(themeDir: string): Promise<FontFace[]> {
  const dir = path.join(themeDir, 'fonts');
  const faces: FontFace[] = [];
  for (const entry of await listFiles(dir)) {
    const match = /^(.+?)-(\d{3})(italic)?\.(woff2|woff|ttf|otf)$/i.exec(entry);
    if (!match) continue;
    faces.push({
      family: (match[1] as string).replace(/[-_]+/g, ' '),
      weight: Number(match[2]),
      style: match[3] ? 'italic' : 'normal',
      file: path.join(dir, entry),
    });
  }
  return faces;
}

const MIME_BY_EXT: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** Build a block of `@font-face` rules with the font bytes inlined. */
export async function fontFaceCss(faces: FontFace[]): Promise<string> {
  const rules: string[] = [];
  for (const face of faces) {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(face.file);
    } catch {
      continue;
    }
    const ext = path.extname(face.file).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'font/woff2';
    const format = mime.split('/')[1];
    rules.push(
      [
        '@font-face {',
        `  font-family: "${face.family}";`,
        `  font-style: ${face.style};`,
        `  font-weight: ${face.weight};`,
        '  font-display: block;',
        `  src: url(data:${mime};base64,${bytes.toString('base64')}) format("${format}");`,
        '}',
      ].join('\n'),
    );
  }
  return rules.join('\n');
}
