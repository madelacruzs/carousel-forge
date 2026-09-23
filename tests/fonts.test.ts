import { describe, expect, it, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ensureGoogleFonts,
  fontCacheDir,
  fontFaceCss,
  themeFontFaces,
  type FontFace,
} from '../src/fonts/google.js';

/**
 * Fonts are the quietest way to lose determinism. Nothing throws, nothing is
 * logged, and the only symptom is that one machine's text is a hair different
 * from another's. These tests pin the one property that prevents it: the CSS
 * depends on which faces are present, never on the order they arrived in.
 */

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function fixture(files: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-fonts-'));
  dirs.push(dir);
  await fs.mkdir(path.join(dir, 'fonts'), { recursive: true });
  for (const file of files) {
    await fs.writeFile(path.join(dir, 'fonts', file), Buffer.from(`fake:${file}`));
  }
  return dir;
}

describe('font face CSS', () => {
  it('is identical no matter what order the faces were collected in', async () => {
    const dir = await fixture([]);
    const faces: FontFace[] = [
      { family: 'Inter', weight: 400, style: 'normal', file: path.join(dir, 'a.woff2') },
      { family: 'Inter', weight: 700, style: 'normal', file: path.join(dir, 'b.woff2') },
      { family: 'Playfair Display', weight: 400, style: 'normal', file: path.join(dir, 'c.woff2') },
      { family: 'Inter', weight: 400, style: 'italic', file: path.join(dir, 'd.woff2') },
    ];
    await Promise.all(faces.map((f) => fs.writeFile(f.file, Buffer.from(f.family + f.weight))));

    // A warm cache yields weights x styles order; a cold cache yields whatever
    // order Google's CSS listed. Both must emit the same stylesheet.
    const warm = await fontFaceCss(faces);
    const cold = await fontFaceCss([...faces].reverse());
    const shuffled = await fontFaceCss([faces[2]!, faces[0]!, faces[3]!, faces[1]!]);

    expect(cold).toBe(warm);
    expect(shuffled).toBe(warm);
    expect(warm.match(/@font-face/g)).toHaveLength(4);
  });

  it('orders theme-owned faces independently of the filesystem', async () => {
    // listFiles returns directory order, which differs between filesystems.
    const a = await fixture(['Inter-400.woff2', 'Inter-700.woff2', 'Cormorant-400.woff2']);
    const b = await fixture(['Cormorant-400.woff2', 'Inter-700.woff2', 'Inter-400.woff2']);

    const cssA = await fontFaceCss(await themeFontFaces(a));
    const cssB = await fontFaceCss(await themeFontFaces(b));

    // The bytes differ per fixture only because the fake file contents encode
    // the directory, so compare the rule order rather than the whole payload.
    const order = (css: string) =>
      [...css.matchAll(/font-family: "(.+?)";[\s\S]*?font-weight: (\d+);/g)].map(
        (m) => `${m[1]}|${m[2]}`,
      );
    expect(order(cssA)).toEqual(['Cormorant|400', 'Inter|400', 'Inter|700']);
    expect(order(cssB)).toEqual(order(cssA));
  });
});

/**
 * A family is cached all at once or not at all.
 *
 * Writing each weight as it arrives means a network failure halfway through
 * leaves some weights on disk and others missing. The build that hit the
 * failure renders with a partial family and lets Chromium synthesise the rest;
 * the very next build on that machine finds those files cached and renders the
 * real glyphs. Identical inputs, different pixels, once per machine.
 */
describe('font cache writes', () => {
  let cache: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const CSS = `
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: url(https://x/400.woff2) format('woff2'); }
    @font-face { font-family: 'Inter'; font-style: normal; font-weight: 700; src: url(https://x/700.woff2) format('woff2'); }
  `;

  const woff2 = (seed: number) =>
    Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(2048, seed)]) as unknown as ArrayBufferLike;

  beforeEach(async () => {
    cache = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-cache-'));
    dirs.push(cache);
    process.env.CAROUSEL_FORGE_CACHE = cache;
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    delete process.env.CAROUSEL_FORGE_CACHE;
  });

  function respond(handler: (url: string) => Promise<Response>) {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => handler(String(input))) as never;
  }

  const request = [{ family: 'Inter', weights: [400, 700], styles: ['normal' as const] }];

  it('caches nothing when one weight fails to download', async () => {
    respond(async (url) => {
      if (url.includes('css2')) return new Response(CSS, { status: 200 });
      if (url.endsWith('400.woff2')) return new Response(woff2(1), { status: 200 });
      return new Response('nope', { status: 503, statusText: 'Service Unavailable' });
    });

    const faces = await ensureGoogleFonts(request);

    expect(faces).toEqual([]);
    expect(await fs.readdir(fontCacheDir())).toEqual([]);
  });

  it('caches the whole family once every weight arrives', async () => {
    respond(async (url) => {
      if (url.includes('css2')) return new Response(CSS, { status: 200 });
      return new Response(woff2(url.endsWith('400.woff2') ? 1 : 2), { status: 200 });
    });

    const faces = await ensureGoogleFonts(request);

    expect(faces.map((f) => f.weight)).toEqual([400, 700]);
    expect((await fs.readdir(fontCacheDir())).sort()).toEqual([
      'inter-400-normal.woff2',
      'inter-700-normal.woff2',
    ]);
  });

  it('refuses to cache a response that is not a font', async () => {
    respond(async (url) => {
      if (url.includes('css2')) return new Response(CSS, { status: 200 });
      // A captive portal or proxy answering 200 with an HTML error page.
      return new Response('<html>blocked</html>', { status: 200 });
    });

    const faces = await ensureGoogleFonts(request);

    expect(faces).toEqual([]);
    expect(await fs.readdir(fontCacheDir())).toEqual([]);
  });

  it('leaves no temporary files behind', async () => {
    respond(async (url) => {
      if (url.includes('css2')) return new Response(CSS, { status: 200 });
      return new Response(woff2(3), { status: 200 });
    });

    await ensureGoogleFonts(request);

    expect((await fs.readdir(fontCacheDir())).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});
