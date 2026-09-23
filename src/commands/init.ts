import path from 'node:path';
import sharp from 'sharp';
import { ForgeError } from '../errors.js';
import { listThemes } from '../theme/load.js';
import { listNarratives } from '../narrative/load.js';
import { displayPath, ensureDir, listFiles, pathExists, writeText } from '../util/fs.js';
import { log, pc } from '../util/log.js';

export interface InitOptions {
  dir: string;
  theme: string;
  narrative: string;
  force?: boolean;
  /** Skip writing sample photos into `images/`. */
  noSamples?: boolean;
}

/** Deterministic stand-in photos so `init` -> `build` works with zero setup. */
const SAMPLES: { name: string; from: string; to: string }[] = [
  { name: 'dusk.jpg', from: '#2b1d16', to: '#c98a4b' },
  { name: 'clay.jpg', from: '#1a1412', to: '#8d5a3b' },
  { name: 'linen.jpg', from: '#151515', to: '#6b6257' },
  { name: 'ember.jpg', from: '#120d0b', to: '#a8422a' },
  { name: 'stone.jpg', from: '#101214', to: '#4d5b63' },
];

async function writeSample(file: string, from: string, to: string): Promise<void> {
  const width = 1620;
  const height = 2025;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.35" r="0.75">
      <stop offset="0%" stop-color="rgba(255,255,255,0.18)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.45)"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <rect width="${width}" height="${height}" fill="url(#v)"/>
</svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(file);
}

function starterCarousel(theme: string, narrative: string): string {
  return `# carousel-forge — content file
# Theme decides how it looks. Narrative decides what it says, and in what order.
# They are independent: any theme combines with any narrative.
theme: ${theme}
narrative: ${narrative}

brand:
  handle: "@yourhandle"
  accent: "#E8C47A"

defaults:
  overlay: 0.55
  numbering: true

slides:
  # 1 — hook. This slide has one job: stop the scroll.
  - image: images/dusk.jpg
    focal: [0.5, 0.35]
    title: |
      5 things i wish i knew
      before i started
    cta: ""

  # 2 — agitation. Make them think "this is me".
  - image: images/clay.jpg
    focal: [0.45, 0.4]
    title: "you're busy every day and still behind"
    body: "it isn't a discipline problem. it's a sequencing problem."

  # 3 — value.
  - image: images/linen.jpg
    title: "start with the ugly version"
    body: "a rough first pass you can react to beats a perfect plan you never begin."

  # 4 — value.
  - image: images/ember.jpg
    title: "one decision per session"
    body: "decide the next thing, not the whole thing."

  # 5 — call to action.
  - layout: cta
    title: "save this for the next time you stall"
    cta: "save this post"
    note: "more like this every week"
`;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const dir = path.resolve(options.dir);
  await ensureDir(dir);

  const themes = await listThemes(dir);
  if (!themes.some((t) => t.name === options.theme)) {
    throw new ForgeError(`Unknown theme "${options.theme}".`, {
      hint: `available themes: ${themes.map((t) => t.name).join(', ')}.`,
    });
  }
  const narratives = await listNarratives(dir);
  if (!narratives.some((n) => n.name === options.narrative)) {
    throw new ForgeError(`Unknown narrative "${options.narrative}".`, {
      hint: `available narratives: ${narratives.map((n) => n.name).join(', ')}.`,
    });
  }

  const configFile = path.join(dir, 'carousel.yaml');
  if ((await pathExists(configFile)) && !options.force) {
    throw new ForgeError(`${displayPath(configFile)} already exists.`, {
      hint: 'pass --force to overwrite it.',
    });
  }

  await ensureDir(path.join(dir, 'images'));
  await ensureDir(path.join(dir, 'assets'));
  await writeText(configFile, starterCarousel(options.theme, options.narrative));
  log.success(`wrote ${displayPath(configFile)}`);

  if (!options.noSamples) {
    const existing = await listFiles(path.join(dir, 'images'));
    if (existing.length === 0) {
      for (const sample of SAMPLES) {
        await writeSample(path.join(dir, 'images', sample.name), sample.from, sample.to);
      }
      log.success(`wrote ${SAMPLES.length} placeholder photos to images/`);
      log.info(pc.dim('  replace them with your own — same file names, no config change needed.'));
    }
  }

  log.info('');
  log.info(`next: ${pc.cyan('carousel-forge build')}`);
}
