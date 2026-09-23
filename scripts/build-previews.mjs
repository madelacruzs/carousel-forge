/**
 * Regenerate `themes/<name>/preview.png` for the README theme catalog.
 *
 *   npm run build && node scripts/build-previews.mjs
 *
 * Each preview is a three-slide contact sheet rendered through the normal
 * pipeline, so the catalog can never drift from what the tool actually
 * produces. Uses the same generated placeholder photos as `init`, so nothing
 * with unclear licensing ends up in the repository.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build, listThemes, renderContactSheet } from '../dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PHOTOS = [
  { name: 'a.jpg', from: '#2b1d16', to: '#c98a4b' },
  { name: 'b.jpg', from: '#151515', to: '#6b6257' },
  { name: 'c.jpg', from: '#120d0b', to: '#a8422a' },
];

/** Copy chosen to show each theme doing the thing it is for. */
const COPY = {
  'warm-editorial': `
slides:
  - image: images/a.jpg
    focal: [0.5, 0.35]
    title: "5 things i wish i knew before i started"
  - image: images/b.jpg
    title: "start with the ugly version"
    body: "a rough first pass you can react to beats a perfect plan you never begin."
  - layout: cta
    title: "save this for the next time you stall"
    cta: "save this post"
    note: "more like this every week"
`,
  'studio-minimal': `
slides:
  - image: images/a.jpg
    focal: [0.5, 0.4]
    eyebrow: "field notes"
    title: "the light does most of the work"
    highlight: "light"
  - image: images/b.jpg
    title: "one material, three finishes"
    body: "oiled, waxed, and left alone. the third one aged best."
    note: "shot on location. finishes shown are representative and may vary by batch."
  - layout: cta
    title: "see the full project"
    cta: "link in bio"
`,
  poster: `
slides:
  - image: images/c.jpg
    focal: [0.5, 0.45]
    eyebrow: "opening this spring"
    title: "the kona home"
    body: "not a venue. a home, with stories in the walls and room for forty at the table."
    cta: "join the list"
  - image: images/a.jpg
    eyebrow: "saturday, june 14"
    title: "an evening in the orchard"
    body: "one long table, six courses, everything picked that morning."
    cta: "reserve a seat"
  - layout: cta
    title: "something beautiful is coming"
    cta: "follow along"
    note: "est. 2019"
`,
};

async function writePhoto(file, from, to) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1620" height="2025">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.35" r="0.75">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>
    </radialGradient>
  </defs>
  <rect width="1620" height="2025" fill="url(#g)"/>
  <rect width="1620" height="2025" fill="url(#v)"/>
</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(file);
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-previews-'));
await fs.mkdir(path.join(dir, 'images'), { recursive: true });
for (const photo of PHOTOS) {
  await writePhoto(path.join(dir, 'images', photo.name), photo.from, photo.to);
}

const themes = await listThemes(root);

for (const theme of themes) {
  const copy = COPY[theme.name];
  if (!copy) {
    console.log(`skip ${theme.name} — no preview copy in scripts/build-previews.mjs`);
    continue;
  }

  const configFile = path.join(dir, 'carousel.yaml');
  const header = [
    `theme: ${theme.name}`,
    'brand:',
    '  handle: "@carouselforge"',
    '  name: "carousel forge"',
    '  url: "carousel-forge.dev"',
    '  accent: "#E8C47A"',
    'defaults:',
    '  overlay: 0.55',
    '  numbering: true',
  ].join('\n');
  await fs.writeFile(configFile, `${header}\n${copy}`, 'utf8');

  const result = await build({
    configFile,
    outDir: path.join(dir, 'out', theme.name),
    contactSheet: false,
    caption: false,
  });

  const sheet = await renderContactSheet({
    slides: result.rendered.map((r) => r.png),
    thumbWidth: 420,
    columns: 3,
  });
  await fs.writeFile(path.join(root, 'themes', theme.name, 'preview.png'), sheet);
  console.log(`wrote themes/${theme.name}/preview.png`);
}

await fs.rm(dir, { recursive: true, force: true });
