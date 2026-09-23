import { describe, expect, it } from 'vitest';
import { CENTER, coverCrop, coverScale, hasEnoughResolution } from '../src/image/crop.js';

const PORTRAIT = { w: 1080, h: 1350 };

describe('coverCrop', () => {
  it('returns the whole source when the aspect ratio already matches', () => {
    expect(coverCrop({ w: 2160, h: 2700 }, PORTRAIT)).toEqual({
      left: 0,
      top: 0,
      width: 2160,
      height: 2700,
    });
  });

  it('trims the sides of a source wider than the target', () => {
    const crop = coverCrop({ w: 4000, h: 2000 }, PORTRAIT, CENTER);
    expect(crop.height).toBe(2000);
    expect(crop.width).toBe(1600); // 2000 * (1080/1350)
    expect(crop.top).toBe(0);
    expect(crop.left).toBe(1200); // centred
  });

  it('trims the top and bottom of a source taller than the target', () => {
    const crop = coverCrop({ w: 2000, h: 4000 }, PORTRAIT, CENTER);
    expect(crop.width).toBe(2000);
    expect(crop.height).toBe(2500); // 2000 / (1080/1350)
    expect(crop.left).toBe(0);
    expect(crop.top).toBe(750);
  });

  it('moves the window towards the focal point', () => {
    const left = coverCrop({ w: 4000, h: 2000 }, PORTRAIT, [0.2, 0.5]);
    const right = coverCrop({ w: 4000, h: 2000 }, PORTRAIT, [0.8, 0.5]);
    expect(left.left).toBe(0); // 0.2*4000 - 800 = 0
    expect(right.left).toBe(2400); // 0.8*4000 - 800
    expect(left.width).toBe(right.width);
  });

  it('never lets the window leave the source, however extreme the focal point', () => {
    for (const focal of [
      [0, 0],
      [1, 1],
      [-5, 12],
      [0.5, 0.5],
    ] as const) {
      const crop = coverCrop({ w: 3000, h: 1200 }, PORTRAIT, focal);
      expect(crop.left).toBeGreaterThanOrEqual(0);
      expect(crop.top).toBeGreaterThanOrEqual(0);
      expect(crop.left + crop.width).toBeLessThanOrEqual(3000);
      expect(crop.top + crop.height).toBeLessThanOrEqual(1200);
    }
  });

  it('keeps the requested aspect ratio within a rounding pixel', () => {
    const crop = coverCrop({ w: 3333, h: 1777 }, PORTRAIT, [0.4, 0.3]);
    expect(crop.width / crop.height).toBeCloseTo(PORTRAIT.w / PORTRAIT.h, 2);
  });

  it('is deterministic for the same inputs', () => {
    const a = coverCrop({ w: 4321, h: 2345 }, PORTRAIT, [0.37, 0.61]);
    const b = coverCrop({ w: 4321, h: 2345 }, PORTRAIT, [0.37, 0.61]);
    expect(a).toEqual(b);
  });

  it('rejects impossible sizes instead of producing a silently wrong crop', () => {
    expect(() => coverCrop({ w: 0, h: 100 }, PORTRAIT)).toThrow(/invalid source/);
    expect(() => coverCrop({ w: 100, h: 100 }, { w: 0, h: 10 })).toThrow(/invalid target/);
  });
});

describe('coverScale', () => {
  it('reports upscaling as a factor below 1', () => {
    expect(coverScale({ w: 540, h: 675 }, PORTRAIT)).toBeCloseTo(0.5);
    expect(hasEnoughResolution({ w: 540, h: 675 }, PORTRAIT)).toBe(false);
  });

  it('accepts a source at exactly the canvas size', () => {
    expect(hasEnoughResolution(PORTRAIT, PORTRAIT)).toBe(true);
  });

  it('is limited by the short side', () => {
    // Wide enough, not tall enough.
    expect(hasEnoughResolution({ w: 5000, h: 900 }, PORTRAIT)).toBe(false);
  });
});
