import { describe, expect, it } from 'vitest';
import { parseCssColor, relativeLuminance, contrastRatio } from '../src/image/prepare.js';

/**
 * `parseCssColor` is the gate on the whole contrast check: when it returns
 * null, `doctor` reads that as "no colour to judge" and skips the slot without
 * a word. A parser gap therefore does not produce a wrong warning, it produces
 * silence — the failure mode that is worst of all, because it looks like a
 * clean bill of health.
 */
describe('parseCssColor', () => {
  it('reads the rgb() form Chromium reports for a plain colour', () => {
    expect(parseCssColor('rgb(232, 196, 122)')).toEqual([232 / 255, 196 / 255, 122 / 255]);
    expect(parseCssColor('rgba(255, 255, 255, 0.8)')).toEqual([1, 1, 1]);
  });

  it('reads hex, in both lengths', () => {
    expect(parseCssColor('#fff')).toEqual([1, 1, 1]);
    expect(parseCssColor('#E8C47A')).toEqual([232 / 255, 196 / 255, 122 / 255]);
  });

  it('reads the color(srgb …) form Chromium reports for color-mix()', () => {
    // Regression: warm-editorial adapts its slide number with color-mix(), and
    // Chromium serialises the computed value in this form. It parsed as null,
    // so the number was never contrast-checked in the project's primary theme.
    const parsed = parseCssColor('color(srgb 0.0705882 0.0509804 0.027451)');
    expect(parsed).not.toBeNull();
    const [r, g, b] = parsed as [number, number, number];
    expect(r).toBeCloseTo(0.0705882, 6);
    expect(g).toBeCloseTo(0.0509804, 6);
    expect(b).toBeCloseTo(0.027451, 6);

    // And it has to reach the real check as a dark ink, not as mid-grey.
    expect(contrastRatio(relativeLuminance(r, g, b), 1.0)).toBeGreaterThan(15);
  });

  it('tolerates an alpha channel and out-of-gamut values on the srgb form', () => {
    expect(parseCssColor('color(srgb 1 1 1 / 0.5)')).toEqual([1, 1, 1]);
    expect(parseCssColor('color(srgb 1.02 -0.01 0.5)')).toEqual([1, 0, 0.5]);
  });

  it('returns null for things it genuinely cannot judge', () => {
    expect(parseCssColor('transparent')).toBeNull();
    expect(parseCssColor('currentColor')).toBeNull();
    expect(parseCssColor('')).toBeNull();
  });
});
