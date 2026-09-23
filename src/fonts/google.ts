import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
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

/** woff2 files start with `wOF2`. A proxy error page or a truncated body does not. */
function looksLikeFont(bytes: Buffer): boolean {
  if (bytes.length < 1024) return false;
  const magic = bytes.subarray(0, 4).toString('latin1');
  return magic === 'wOF2' || magic === 'wOFF' || magic === '\0\u0001\0\0' || magic === 'OTTO';
}

/**
 * Write a font into the cache via a temporary file in the same directory.
 * A half-written woff2 that keeps its final name would be reused by every
 * later build on this machine, which is a permanent, invisible corruption.
 *
 * The temporary name has to be unique per call, not per process. Vitest runs
 * test files in worker *threads*, so two concurrent writers share a pid; a
 * pid-based temporary name means both write the same file at once and one of
 * them renames the interleaved result into place.
 */
async function commitFont(file: string, bytes: Buffer): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, file);
}

/**
 * Ensure every requested family/weight/style is present in the cache.
 * Returns the faces that are available; anything that could not be fetched is
 * reported and skipped so a build never hard-fails on a network hiccup.
 */
export async function ensureGoogleFonts(requests: FontRequest[]): Promise<FontFace[]> {
  const wantedByRequest: { request: FontRequest; wanted: FontFace[] }[] = [];
  const missing = new Set<FontRequest>();

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
    wantedByRequest.push({ request, wanted });
    for (const face of wanted) {
      if (!(await pathExists(face.file))) {
        missing.add(request);
        break;
      }
    }
  }

  if (missing.size > 0) {
    await ensureDir(fontCacheDir());
  }
  for (const request of missing) {
    try {
      const css = await download(css2Url(request), {
        headers: { 'User-Agent': UA },
      }).then((b) => b.toString('utf8'));

      // Fetch the whole family into memory before writing any of it.
      //
      // This is load-bearing for determinism. Writing each face as it arrives
      // means a failure halfway through leaves some weights cached and others
      // not: the build that hit the failure renders with a partial family and
      // lets the browser synthesise the rest, while the next build on the same
      // machine finds those files cached and renders the real glyphs. Same
      // inputs, different pixels, and only ever on the first build after a
      // network hiccup - the hardest possible thing to reproduce.
      // Google returns one `@font-face` block per unicode-range subset, and
      // every subset of a weight collapses onto the same cache filename. Pick
      // the subset deliberately and download it once.
      //
      // Downloading each block in turn and letting the last write win means
      // two builds racing on a cold cache can leave different bytes under the
      // same name, depending on how far each got before the other renamed its
      // file into place - and it downloads seven files to keep one.
      //
      // The last block Google emits is `latin` (U+0000-00FF plus a handful of
      // punctuation), which covers English and the accented characters of the
      // Western European languages. Known limitation: text in Cyrillic, Greek,
      // Vietnamese or the Latin-Extended range is not covered by this subset
      // and the browser will fall back to a system font for those characters.
      // Caching every subset instead would multiply the inlined font payload
      // by seven, so that trade is left for when a theme actually needs it.
      const chosen = new Map<string, ParsedFace>();
      for (const face of parseGoogleCss(css)) {
        if (!request.weights.includes(face.weight)) continue;
        if (!request.styles.includes(face.style)) continue;
        chosen.set(`${face.weight}|${face.style}`, face);
      }

      const staged: { file: string; bytes: Buffer }[] = [];
      for (const face of chosen.values()) {
        const file = cacheFileFor(request.family, face.weight, face.style);
        if (await pathExists(file)) continue;
        const bytes = await download(face.url);
        if (!looksLikeFont(bytes)) {
          throw new Error(`${face.url} did not return a font file`);
        }
        staged.push({ file, bytes });
      }

      for (const { file, bytes } of staged) {
        await commitFont(file, bytes);
      }
    } catch (error) {
      log.warn(
        `Could not download "${request.family}" (${(error as Error).message}). ` +
          'Rendering will fall back to a system font, so the output may differ from a machine that has the font cached.',
      );
    }
  }

  // Resolve the final list from the cache directory rather than from what this
  // call happened to download.
  //
  // Two builds can run against the same cache at once - parallel test workers
  // are the obvious case - and then a face this call decided was absent can be
  // written by the other process a moment later. Tracking availability as we
  // go drops exactly those faces: the scan says "absent", the download loop
  // says "already there, skip", and the face ends up in neither list, so the
  // page is served a family with a weight missing and the browser synthesises
  // it. The glyphs differ from every other build, and only on the first build
  // against a cold cache. Asking the filesystem at the end is indifferent to
  // who wrote the file.
  const resolved: FontFace[] = [];
  for (const { request, wanted } of wantedByRequest) {
    for (const face of wanted) {
      if (await pathExists(face.file)) resolved.push(face);
      else if (missing.has(request)) {
        log.warn(
          `"${face.family}" ${face.weight} ${face.style} is not in the font cache. ` +
            'The browser will synthesise it, which will not match a machine that has it cached.',
        );
      }
    }
  }
  return sortFaces(resolved);
}

/**
 * Order faces by family, then weight, then style.
 *
 * This is load-bearing for determinism, not tidiness. A warm cache collects
 * faces in `weights x styles` order; a cold cache collects them in whatever
 * order Google's CSS happens to list them. Without a canonical sort the two
 * produce the same faces in a different order, the `@font-face` rules are
 * emitted in a different order, and the first build on a cold machine can
 * resolve a weight differently from every build after it. That is a
 * once-per-machine difference, which is the hardest kind to reproduce.
 */
function sortFaces(faces: FontFace[]): FontFace[] {
  return [...faces].sort(
    (a, b) =>
      a.family.localeCompare(b.family, 'en') ||
      a.weight - b.weight ||
      a.style.localeCompare(b.style, 'en'),
  );
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
  // Sort at the point of emission too: theme-owned faces are concatenated with
  // Google ones, and the CSS this returns must not depend on how that list was
  // assembled.
  for (const face of sortFaces(faces)) {
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
