import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { build } from '../src/pipeline/build.js';
import { captionIsPristine, outlineDelta } from '../src/pipeline/caption.js';

/**
 * A caption is the one artifact in `out/` that a human writes by hand, and it
 * lives in a directory whose whole job is to be regenerated. Losing it to a
 * routine rebuild costs real writing and is invisible until someone goes to
 * post. These tests pin the rule: `build` writes a scaffold, and after that
 * the words belong to whoever typed them.
 */

const CAROUSEL = (title: string) => `
theme: warm-editorial
narrative: viral-5
brand:
  handle: "@captions"
slides:
  - image: images/a.png
    title: "${title}"
  - layout: cta
    title: "save this"
    cta: "@captions"
`;

let dir: string;
let out: string;
let captionFile: string;

const WRITTEN = '# Caption\n\nthe words a person actually wrote, at some cost.\n';

async function photo(file: string): Promise<void> {
  await sharp({
    create: { width: 1400, height: 1700, channels: 3, background: { r: 40, g: 44, b: 52 } },
  })
    .png()
    .toFile(file);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-caption-'));
  out = path.join(dir, 'out');
  captionFile = path.join(out, 'caption.md');
  await fs.mkdir(path.join(dir, 'images'), { recursive: true });
  await photo(path.join(dir, 'images', 'a.png'));
  await fs.writeFile(path.join(dir, 'carousel.yaml'), CAROUSEL('before'), 'utf8');
}, 120_000);

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const run = (forceCaption = false) =>
  build({ configFile: path.join(dir, 'carousel.yaml'), outDir: out, forceCaption });

describe('caption.md', () => {
  it('survives a rebuild after a human fills it in', async () => {
    const first = await run();
    expect(first.captionPreserved).toBeUndefined();
    expect(await fs.readFile(captionFile, 'utf8')).toContain('<!-- TODO -->');

    await fs.writeFile(captionFile, WRITTEN, 'utf8');

    // The exact thing that bit us: edit a slide, rebuild, keep the caption.
    await fs.writeFile(path.join(dir, 'carousel.yaml'), CAROUSEL('after'), 'utf8');
    const second = await run();

    expect(second.captionPreserved).toBe(true);
    expect(await fs.readFile(captionFile, 'utf8')).toBe(WRITTEN);
  }, 120_000);

  it('keeps the mechanical outline current in its own file', async () => {
    const result = await run();
    const outline = await fs.readFile(result.outlineFile as string, 'utf8');
    expect(path.basename(result.outlineFile as string)).toBe('slide-outline.md');
    // The slide title changed in the test above; the outline must have followed
    // even though the caption did not.
    expect(outline).toContain('after');
    expect(outline).not.toContain('before');
  }, 120_000);

  it('replaces the caption only when explicitly told to', async () => {
    expect(await fs.readFile(captionFile, 'utf8')).toBe(WRITTEN);

    const forced = await run(true);

    expect(forced.captionPreserved).toBeUndefined();
    expect(await fs.readFile(captionFile, 'utf8')).toContain('<!-- TODO -->');
  }, 120_000);
});

describe('captionIsPristine', () => {
  it('recognises its own untouched scaffold by hash', async () => {
    const scaffold = await fs.readFile(captionFile, 'utf8');
    expect(captionIsPristine(scaffold)).toBe(true);
    expect(captionIsPristine(scaffold.replace('# Caption', '# Caption for real'))).toBe(false);
  });

  it('falls back to TODO markers when the stamp is gone', () => {
    expect(captionIsPristine('# Caption\n\n<!-- TODO --> write it\n')).toBe(true);
    expect(captionIsPristine('# Caption\n\nwritten by a person\n')).toBe(false);
  });

  it('treats an unreadable stamp as edited rather than guessing', () => {
    const tampered = `# Caption\n\nmine\n\n<!-- carousel-forge:scaffold ${'0'.repeat(64)} -->\n`;
    expect(captionIsPristine(tampered)).toBe(false);
  });
});

describe('outlineDelta', () => {
  it('names the slides that moved under a preserved caption', () => {
    const before = '1. **hook** - old hook\n2. **cta** - save this\n';
    const after = '1. **hook** - new hook\n2. **cta** - save this\n3. **value** - extra\n';
    expect(outlineDelta(before, after)).toEqual([
      'slide 1 changed - **hook** - new hook',
      'slide 3 added - **value** - extra',
    ]);
  });

  it('is silent when nothing changed', () => {
    const outline = '1. **hook** - same\n';
    expect(outlineDelta(outline, outline)).toEqual([]);
  });
});
