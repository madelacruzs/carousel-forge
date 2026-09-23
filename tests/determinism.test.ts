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
async function describeDifference(a: Buffer, b: Buffer): Promise<string> {
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
  it('produces byte-identical PNGs across three independent builds', async () => {
    const results = [];
    for (const out of ['out-1', 'out-2', 'out-3']) {
      // Drop every cache and launch a fresh browser process each time, so the
      // runs share nothing beyond the files on disk. Three rather than two:
      // with two, "the first render in a cold process is different" and
      // "the renderer is randomly noisy" look identical, and they need very
      // different fixes.
      clearImageCache();
      clearTemplateCache();
      results.push(
        await build({ configFile: path.join(dir, 'carousel.yaml'), outDir: path.join(dir, out) }),
      );
    }
    const [first] = results;
    if (!first) throw new Error('no builds ran');

    const slides = first.files.filter((f) => /slide-\d+\.png$/.test(f));
    expect(slides.length).toBe(3);

    const names = [...slides.map((f) => path.basename(f)), 'contact-sheet.png'];
    for (const name of names) {
      const bytes = await Promise.all(
        ['out-1', 'out-2', 'out-3'].map((out) => fs.readFile(path.join(dir, out, name))),
      );
      for (let i = 1; i < bytes.length; i += 1) {
        const a = bytes[0];
        const b = bytes[i];
        if (!a || !b) throw new Error(`${name} missing from build ${i + 1}`);
        if (sha(a) !== sha(b)) {
          throw new Error(
            `${name} differs between build 1 and build ${i + 1}: ${await describeDifference(a, b)}`,
          );
        }
      }
    }

    expect(results[1]?.rendered).toHaveLength(first.rendered.length);
  }, 300_000);

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
