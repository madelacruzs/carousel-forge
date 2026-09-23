import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { build } from '../src/pipeline/build.js';
import { doctor } from '../src/doctor/index.js';
import { loadProject } from '../src/pipeline/context.js';

/**
 * Every theme was originally validated against flat, self-generated gradients,
 * which is exactly the case the overlay never has to work for. A real photo is
 * large, high-frequency and unevenly lit, and it broke the renderer in two
 * distinct ways:
 *
 *  1. a cropped 1080x1350 photograph encodes to several megabytes, and Chromium
 *     silently drops any `data:` URI over ~2MB, so the slide rendered with no
 *     photo at all and nothing anywhere reported a failure;
 *  2. a fixed overlay that looks fine over a dark gradient leaves white type
 *     sitting on a blown-out white wall.
 *
 * These tests stand in for real photographs using synthetic sources that are
 * deliberately hostile in the same two ways, so neither regression can return
 * quietly.
 */

/** Deterministic high-frequency noise: large, incompressible, and busy. */
async function noisePhoto(file: string, w: number, h: number): Promise<void> {
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
  await sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    .png({ compressionLevel: 0 })
    .toFile(file);
}

/** A harsh black-over-white split: the copy lands on the blown-out half. */
async function splitPhoto(file: string, w: number, h: number): Promise<void> {
  const white = await sharp({
    create: { width: w, height: Math.floor(h / 2), channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  await sharp({
    create: { width: w, height: h, channels: 3, background: '#000000' },
  })
    .composite([{ input: white, top: Math.floor(h / 2), left: 0 }])
    .png({ compressionLevel: 0 })
    .toFile(file);
}

/** A theme that overlays a fixed scrim and ignores what the photo is doing. */
const NAIVE_THEME_JSON = JSON.stringify(
  {
    name: 'naive',
    description: 'Control fixture: a fixed overlay that never looks at the photograph.',
    canvas: { w: 1080, h: 1350 },
    safeArea: { top: 80, right: 72, bottom: 120, left: 72 },
    tokens: { accent: '#E8C47A', ink: '#FFFFFF', fontDisplay: 'Inter', fontBody: 'Inter' },
    slots: ['title', 'body', 'index', 'handle'],
    layouts: ['default'],
    fonts: [{ family: 'Inter', weights: [400, 600], styles: ['normal'] }],
  },
  null,
  2,
);

const NAIVE_TEMPLATE = `<div class="slide">
  {{#if hasImage}}<div class="photo"></div>{{/if}}
  <div class="scrim"></div>
  <div class="content">
    <h1 class="title" data-slot="title">{{#each titleLines}}<span class="line">{{this}}</span>{{/each}}</h1>
    {{#if body}}<div class="body" data-slot="body">{{#each bodyLines}}<p>{{this}}</p>{{/each}}</div>{{/if}}
  </div>
</div>`;

const NAIVE_CSS = `.slide { position: absolute; inset: 0; background: #000; color: var(--ink);
  font-family: var(--font-body), sans-serif; overflow: hidden; }
.photo { position: absolute; inset: 0; background-image: var(--image);
  background-size: cover; background-position: center; }
/* The bug under test: a constant alpha, chosen against a dark test gradient. */
.scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.3); }
.content { position: absolute; left: var(--safe-left); right: var(--safe-right);
  bottom: var(--safe-bottom); }
.title { margin: 0 0 18px; font-size: 92px; line-height: 1; font-weight: 600; color: var(--ink); }
.title .line { display: block; }
.body p { margin: 0; font-size: 28px; line-height: 1.5; color: var(--ink); }`;

function carousel(theme: string, image: string): string {
  return `theme: ${theme}
brand:
  handle: "@hard.photo"
defaults:
  overlay: 0.55
  numbering: true
slides:
  - image: images/${image}
    focal: [0.5, 0.5]
    title: "legible over anything"
    body: "this line has to survive whatever is behind it."
`;
}

let dir: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-hard-'));
  await fs.mkdir(path.join(dir, 'images'), { recursive: true });
  await fs.mkdir(path.join(dir, 'themes', 'naive'), { recursive: true });
  await fs.writeFile(path.join(dir, 'themes', 'naive', 'theme.json'), NAIVE_THEME_JSON, 'utf8');
  await fs.writeFile(path.join(dir, 'themes', 'naive', 'template.html'), NAIVE_TEMPLATE, 'utf8');
  await fs.writeFile(path.join(dir, 'themes', 'naive', 'theme.css'), NAIVE_CSS, 'utf8');
  await noisePhoto(path.join(dir, 'images', 'noise.png'), 1620, 2025);
  await splitPhoto(path.join(dir, 'images', 'split.png'), 1620, 2026);
}, 180_000);

afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

async function buildOne(theme: string, image: string, out: string): Promise<string> {
  const config = path.join(dir, `${out}.yaml`);
  await fs.writeFile(config, carousel(theme, image), 'utf8');
  await build({ configFile: config, outDir: path.join(dir, out), contactSheet: false });
  return path.join(dir, out, 'slide-01.png');
}

describe('rendering a genuinely hard photograph', () => {
  it('encodes a source too large to have survived as a data URI', async () => {
    const { size } = await fs.stat(path.join(dir, 'images', 'noise.png'));
    // Chromium silently drops data: URIs past ~2MB. Base64 adds ~33% on top of
    // this, so anything near the limit here would have vanished before the fix.
    expect(size).toBeGreaterThan(2 * 1024 * 1024);
  });

  it('actually paints the photograph instead of dropping it silently', async () => {
    const slide = await buildOne('warm-editorial', 'noise.png', 'out-noise');
    // A dropped photo leaves the theme's flat background: near-zero variance.
    // Noise that really painted is the opposite.
    const { channels } = await sharp(slide).stats();
    const stdev = Math.max(...channels.map((c) => c.stdev));
    expect(stdev).toBeGreaterThan(12);
  }, 180_000);

  it('keeps the title legible over a blown-out white region', async () => {
    const config = path.join(dir, 'warm-split.yaml');
    await fs.writeFile(config, carousel('warm-editorial', 'split.png'), 'utf8');
    const project = await loadProject({ configFile: config });
    const report = await doctor({ project });
    const bad = report.diagnostics.filter(
      (f) => f.code === 'layout/low-contrast' && /"(title|body)"/.test(f.message),
    );
    expect(bad, bad.map((f) => f.message).join('\n')).toHaveLength(0);
  }, 180_000);

  it("fires doctor's contrast check when the scrim ignores the photograph", async () => {
    // The control. If this ever passes silently, the contrast check has been
    // tuned into uselessness and the test above proves nothing.
    const config = path.join(dir, 'naive-split.yaml');
    await fs.writeFile(config, carousel('naive', 'split.png'), 'utf8');
    const project = await loadProject({ configFile: config });
    const report = await doctor({ project });
    const bad = report.diagnostics.filter((f) => f.code === 'layout/low-contrast');
    expect(bad.length).toBeGreaterThan(0);
  }, 180_000);
});
