import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { build } from '../src/pipeline/build.js';
import { clearImageCache } from '../src/image/prepare.js';
import { clearTemplateCache } from '../src/render/html.js';

/**
 * The promise of this tool is that the same inputs produce the same bytes, on
 * any machine, on any day. If this test ever goes red, the export is no longer
 * reproducible and the theme catalog in the README is no longer trustworthy.
 */

const CAROUSEL = `
theme: warm-editorial
narrative: viral-5
brand:
  handle: "@determinism"
  accent: "#E8C47A"
defaults:
  overlay: 0.55
  numbering: true
slides:
  - image: images/a.png
    focal: [0.4, 0.3]
    title: "the same bytes every time"
  - image: images/b.png
    title: "no clocks, no randomness"
    body: "fonts are cached and inlined, photos are cropped before the browser sees them."
  - layout: cta
    title: "reproducible by construction"
    cta: "save this post"
`;

let dir: string;

function sha(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * "The bytes differ" is useless on a CI machine you cannot poke at. Say where
 * and by how much instead: a photograph that failed to paint covers the frame,
 * a font that fell back moves a few small boxes, and a colour-management
 * difference shifts every pixel by a little.
 */
async function describe(a: Buffer, b: Buffer): Promise<string> {
  const [ra, rb] = await Promise.all(
    [a, b].map((buf) => sharp(buf).raw().toBuffer({ resolveWithObject: true })),
  );
  if (!ra || !rb) return 'could not decode one of the two PNGs';
  const { width, height, channels } = ra.info;
  let differing = 0;
  let maxDelta = 0;
  let sumDelta = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < ra.data.length; i += channels) {
    let delta = 0;
    for (let c = 0; c < channels; c += 1) {
      delta = Math.max(delta, Math.abs((ra.data[i + c] ?? 0) - (rb.data[i + c] ?? 0)));
    }
    if (delta === 0) continue;
    differing += 1;
    sumDelta += delta;
    maxDelta = Math.max(maxDelta, delta);
    const pixel = i / channels;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const percent = ((differing / (width * height)) * 100).toFixed(2);
  return [
    `${differing} of ${width * height} pixels (${percent}%)`,
    `max channel delta ${maxDelta}, mean ${(sumDelta / Math.max(differing, 1)).toFixed(1)}`,
    `bounding box ${minX},${minY} to ${maxX},${maxY}`,
  ].join('; ');
}

/** A flat, fully deterministic source photo. */
async function photo(file: string, rgb: [number, number, number]): Promise<void> {
  const png = await sharp({
    create: {
      width: 1620,
      height: 2025,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await fs.writeFile(file, png);
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-determinism-'));
  await fs.mkdir(path.join(dir, 'images'), { recursive: true });
  await fs.writeFile(path.join(dir, 'carousel.yaml'), CAROUSEL, 'utf8');
  await photo(path.join(dir, 'images', 'a.png'), [58, 44, 36]);
  await photo(path.join(dir, 'images', 'b.png'), [36, 40, 48]);
}, 120_000);

afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('determinism', () => {
  it('produces byte-identical PNGs across two independent builds', async () => {
    const first = await build({
      configFile: path.join(dir, 'carousel.yaml'),
      outDir: path.join(dir, 'out-1'),
    });

    // Drop every cache and use a second browser process, so the second run
    // shares nothing with the first beyond the files on disk.
    clearImageCache();
    clearTemplateCache();

    const second = await build({
      configFile: path.join(dir, 'carousel.yaml'),
      outDir: path.join(dir, 'out-2'),
    });

    const slides = first.files.filter((f) => /slide-\d+\.png$/.test(f));
    expect(slides.length).toBe(3);

    for (const file of slides) {
      const twin = path.join(dir, 'out-2', path.basename(file));
      const a = await fs.readFile(file);
      const b = await fs.readFile(twin);
      if (sha(a) !== sha(b)) {
        throw new Error(`${path.basename(file)} differs between runs: ${await describe(a, b)}`);
      }
    }

    const sheetA = await fs.readFile(path.join(dir, 'out-1', 'contact-sheet.png'));
    const sheetB = await fs.readFile(path.join(dir, 'out-2', 'contact-sheet.png'));
    expect(sha(sheetB)).toBe(sha(sheetA));

    expect(second.rendered).toHaveLength(first.rendered.length);
  }, 180_000);

  it('exports at exactly the size the theme declares', async () => {
    const meta = await sharp(path.join(dir, 'out-1', 'slide-01.png')).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
  });

  it('writes no metadata that would vary between machines', async () => {
    const png = await fs.readFile(path.join(dir, 'out-1', 'slide-01.png'));
    // tIME and tEXt chunks are the usual carriers of build time and tooling.
    expect(png.includes(Buffer.from('tIME'))).toBe(false);
    expect(png.includes(Buffer.from('tEXt'))).toBe(false);
  });
});
