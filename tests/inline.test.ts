import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { chromium, type Browser } from 'playwright';
import { clearAssets, registerAsset } from '../src/render/assets.js';
import { CUSTOM_PROPERTY_CEILING, inlineFrameAssets } from '../src/render/inline.js';
import { isForgeError } from '../src/errors.js';

/**
 * The preview path, exercised in a real browser.
 *
 * This was found the only way it could have been: by putting eight real
 * photographs through an editor built on top of this library and watching six
 * of them turn into black rectangles while the published PNGs stayed perfect.
 * The tests below therefore assert against what Chromium actually paints, not
 * against string lengths — the failure mode is silent, so a check that cannot
 * see pixels cannot see the bug.
 */

/** Deterministic high-frequency noise: large, incompressible, and busy. */
async function noisePng(w: number, h: number): Promise<Buffer> {
  const pixels = Buffer.allocUnsafe(w * h * 3);
  let seed = 0x2f6e2b1;
  for (let i = 0; i < pixels.length; i += 1) {
    // xorshift32 — no clocks, no Math.random, identical on every machine.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    pixels[i] = seed & 0xff;
  }
  return sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

/**
 * The shape every built-in theme uses: the photograph reaches the page through
 * a custom property, never as a direct declaration.
 */
function photoDocument(url: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  :root { --image: url("${url}"); }
  body { width: 360px; height: 450px; background: #000; }
  .photo { position: absolute; inset: 0;
           background-image: var(--image); background-size: cover; }
</style></head><body><div class="photo"></div></body></html>`;
}

let browser: Browser;
let bigPng: Buffer;
let smallPng: Buffer;

beforeAll(async () => {
  browser = await chromium.launch();
  bigPng = await noisePng(1080, 1350);
  smallPng = await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#2f6e2b' },
  })
    .png()
    .toBuffer();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  clearAssets();
});

/** How much detail actually reached the glass. A dropped photo is flat black. */
async function paintedDetail(html: string): Promise<number> {
  const page = await browser.newPage({ viewport: { width: 360, height: 450 } });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const shot = await page.screenshot({ type: 'png' });
    const { channels } = await sharp(shot).stats();
    return Math.max(...channels.map((c) => c.stdev));
  } finally {
    await page.close();
  }
}

describe('inlineFrameAssets', () => {
  it('produces a photograph Chromium will actually paint through var(--image)', async () => {
    const url = registerAsset(bigPng, 'image/png');
    const html = await inlineFrameAssets(photoDocument(url));

    expect(html).not.toContain(url);
    // Noise that really painted has enormous variance; a dropped custom
    // property leaves the body's flat black, which has none.
    expect(await paintedDetail(html)).toBeGreaterThan(12);
  }, 180_000);

  it('does not paint the same photograph inlined verbatim', async () => {
    // The control, and the reason any of this exists. Chromium accepts this
    // document without complaint and paints nothing: 5.8 MB of data URI in a
    // custom property is silently discarded. If this ever starts painting,
    // Chromium has raised its limit and this control can be retired — the fix
    // itself stays worthwhile for every browser version that has not.
    const verbatim = `data:image/png;base64,${bigPng.toString('base64')}`;
    expect(await paintedDetail(photoDocument(verbatim))).toBeLessThan(0.5);
  }, 180_000);

  it('keeps the inlined photo under the ceiling the cliff sits above', async () => {
    const url = registerAsset(bigPng, 'image/png');
    const verbatim = `data:image/png;base64,${bigPng.toString('base64')}`;
    // The control: left alone, this photograph is far past the limit. If this
    // ever stops being true the fixture has gone soft and the test above is
    // no longer testing anything.
    expect(verbatim.length).toBeGreaterThan(CUSTOM_PROPERTY_CEILING);

    const html = await inlineFrameAssets(photoDocument(url));
    const uri = /url\("(data:[^"]+)"\)/.exec(html)?.[1] ?? '';
    expect(uri.length).toBeLessThanOrEqual(CUSTOM_PROPERTY_CEILING);
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true);
  }, 180_000);

  it('leaves anything that already fits byte-for-byte alone', async () => {
    const url = registerAsset(smallPng, 'image/png');
    const html = await inlineFrameAssets(photoDocument(url));
    // Lossy re-encoding is a last resort, not a policy. A logo, an icon or a
    // modest photo has to come out the other side unchanged.
    expect(html).toContain(`data:image/png;base64,${smallPng.toString('base64')}`);
  });

  it('never re-encodes an SVG', async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4">${'<!--'}${'x'.repeat(
        CUSTOM_PROPERTY_CEILING,
      )}${'-->'}</svg>`,
    );
    const url = registerAsset(svg, 'image/svg+xml');
    const html = await inlineFrameAssets(photoDocument(url));
    expect(html).toContain('data:image/svg+xml;base64,');
  });

  it('replaces every reference to the same asset, not just the first', async () => {
    const url = registerAsset(smallPng, 'image/png');
    const html = await inlineFrameAssets(
      `<style>:root { --image: url("${url}"); --image-b: url("${url}"); }</style>`,
    );
    expect(html).not.toContain(url);
  });

  it('explains itself when the asset is gone', async () => {
    const url = registerAsset(smallPng, 'image/png');
    const html = photoDocument(url);
    clearAssets();
    // Assets live in the process that rendered the frame. Inlining somewhere
    // else silently produced a document with dead URLs before this threw.
    await expect(inlineFrameAssets(html)).rejects.toSatisfy(isForgeError);
  });
});
