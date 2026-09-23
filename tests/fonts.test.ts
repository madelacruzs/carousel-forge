import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fontFaceCss, themeFontFaces, type FontFace } from '../src/fonts/google.js';

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
