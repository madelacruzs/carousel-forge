import { describe, expect, it, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { prepareImage } from '../src/image/prepare.js';

/**
 * The focal point has to survive the whole image pipeline, not just the crop
 * arithmetic.
 *
 * `coverCrop` is unit-tested on numbers, but the number that matters is the
 * one sharp actually extracts, and 1080x1350 is a narrow window: a 4:3
 * landscape source loses 55% of its width and a tall portrait source loses a
 * third of its height. A sign error or an off-by-one in the extract call is
 * invisible in the crop maths and obvious in the output, so these tests read
 * the pixels back.
 *
 * Each fixture is a flat grey field with a small saturated marker at a known
 * position. If the crop honours the focal point the marker is somewhere in the
 * 1080x1350 result; if it does not, the marker is gone entirely.
 */

const TARGET = { w: 1080, h: 1350 };
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

/** A grey canvas with one red 80x80 square centred on `at` (fractions of w/h). */
async function fixture(
  width: number,
  height: number,
  at: readonly [number, number],
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-focal-'));
  dirs.push(dir);
  const size = 80;
  const left = Math.round(at[0] * width - size / 2);
  const top = Math.round(at[1] * height - size / 2);
  const marker = await sharp({
    create: { width: size, height: size, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  const file = path.join(dir, `${width}x${height}.png`);
  await sharp({
    create: { width, height, channels: 3, background: '#808080' },
  })
    .composite([
      {
        input: marker,
        left: Math.max(0, Math.min(width - size, left)),
        top: Math.max(0, Math.min(height - size, top)),
      },
    ])
    .png()
    .toFile(file);
  return file;
}

/** How much of the result is the marker colour, and where its centre sits. */
async function findMarker(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    if (r > 180 && g < 90 && b < 90) {
      const pixel = i / info.channels;
      count += 1;
      sumX += pixel % info.width;
      sumY += Math.floor(pixel / info.width);
    }
  }
  return {
    found: count > 0,
    count,
    x: count > 0 ? sumX / count : -1,
    y: count > 0 ? sumY / count : -1,
    width: info.width,
    height: info.height,
  };
}

describe('focal point survives the crop to 1080x1350', () => {
  it('keeps an off-centre subject from a wide landscape source', async () => {
    // 4:3, the shape of a phone photo held sideways. Cover-cropping to 0.8
    // throws away more than half the width, so a subject at 20% across is
    // outside the centred crop and only survives if the focal point is used.
    const file = await fixture(1440, 1080, [0.08, 0.5]);

    const centred = await prepareImage({ file, target: TARGET, focal: [0.5, 0.5] });
    const focused = await prepareImage({ file, target: TARGET, focal: [0.08, 0.5] });

    const withoutFocal = await findMarker(centred.buffer);
    const withFocal = await findMarker(focused.buffer);

    expect(withoutFocal.found).toBe(false);
    expect(withFocal.found).toBe(true);
    expect(withFocal.width).toBe(1080);
    expect(withFocal.height).toBe(1350);
  });

  it('keeps an off-centre subject from a tall portrait source', async () => {
    // 9:16, the shape of a phone photo held upright. Now the crop trims the
    // top and bottom instead, so the vertical focal point is what matters.
    const file = await fixture(1080, 1920, [0.5, 0.05]);

    const centred = await prepareImage({ file, target: TARGET, focal: [0.5, 0.5] });
    const focused = await prepareImage({ file, target: TARGET, focal: [0.5, 0.05] });

    expect((await findMarker(centred.buffer)).found).toBe(false);

    const withFocal = await findMarker(focused.buffer);
    expect(withFocal.found).toBe(true);
    expect(withFocal.width).toBe(1080);
    expect(withFocal.height).toBe(1350);
  });

  it('never crops outside the source, however extreme the focal point', async () => {
    // A focal point in the corner asks for a window that runs off the edge.
    // Clamping has to keep the frame full, or the export gets a grey border.
    for (const focal of [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ] as const) {
      const file = await fixture(3000, 1200, [focal[0], focal[1]]);
      const prepared = await prepareImage({ file, target: TARGET, focal });
      const marker = await findMarker(prepared.buffer);
      expect(marker.width).toBe(1080);
      expect(marker.height).toBe(1350);
      expect(marker.found).toBe(true);
    }
  });
});
