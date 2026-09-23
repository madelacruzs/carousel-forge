import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../src/doctor/index.js';
import { loadProject } from '../src/pipeline/context.js';

/**
 * The defect this guards actually shipped.
 *
 * The font cache held a subset containing no latin glyphs. Chromium
 * substituted a system font for every latin character, the slides still looked
 * like competent typography, and nothing in the tool said a word — the
 * committed theme previews were rendered that way for days. A substituted font
 * is invisible unless you happen to know both typefaces, so a machine has to
 * be the one that notices.
 */

const THEME_JSON = (name: string, family: string) =>
  JSON.stringify(
    {
      name,
      description: 'Fixture: checks which font the glyphs actually came from.',
      canvas: { w: 1080, h: 1350 },
      safeArea: { top: 80, right: 72, bottom: 120, left: 72 },
      tokens: { accent: '#E8C47A', ink: '#FFFFFF', fontDisplay: family, fontBody: family },
      slots: ['title'],
      layouts: ['default'],
      fonts: [{ family: 'Inter', weights: [400], styles: ['normal'] }],
    },
    null,
    2,
  );

const TEMPLATE = `<div class="slide">
  <h1 class="title" data-slot="title">{{#each titleLines}}<span class="line">{{this}}</span>{{/each}}</h1>
</div>`;

const CSS = `.slide { position: absolute; inset: 0; background: #101014; color: var(--ink);
  font-family: var(--font-body), serif; overflow: hidden; }
.title { position: absolute; left: var(--safe-left); right: var(--safe-right);
  bottom: var(--safe-bottom); margin: 0; font-size: 84px; line-height: 1.05;
  color: var(--ink); font-family: var(--font-display), serif; }
.title .line { display: block; }`;

// Spanish is the case that matters here: the copy in the repo's own sandbox
// carousel is Spanish, and a latin-free cache fails it on the first accent.
const SPANISH = 'el primer invierno no se supera. años, aquí, ¿sí?';

let dir: string;

async function theme(name: string, family: string): Promise<void> {
  const themeDir = path.join(dir, 'themes', name);
  await fs.mkdir(themeDir, { recursive: true });
  await fs.writeFile(path.join(themeDir, 'theme.json'), THEME_JSON(name, family), 'utf8');
  await fs.writeFile(path.join(themeDir, 'template.html'), TEMPLATE, 'utf8');
  await fs.writeFile(path.join(themeDir, 'theme.css'), CSS, 'utf8');
}

async function config(name: string, themeName: string): Promise<string> {
  const file = path.join(dir, `${name}.yaml`);
  await fs.writeFile(
    file,
    `theme: ${themeName}\nslides:\n  - title: ${JSON.stringify(SPANISH)}\n`,
    'utf8',
  );
  return file;
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'carousel-forge-glyphs-'));
  await fs.mkdir(path.join(dir, 'themes'), { recursive: true });
  // A family no machine has, standing in for a cached face that supplies no
  // glyphs: in both cases Chromium quietly falls back for every character.
  await theme('absent', 'No Such Typeface Anywhere');
  await theme('present', 'Inter');
}, 180_000);

afterAll(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe('detecting a silently substituted font', () => {
  it('reports the characters the requested face never supplied', async () => {
    const project = await loadProject({ configFile: await config('absent', 'absent') });
    const report = await doctor({ project });
    const found = report.diagnostics.filter((d) => d.code === 'font/missing-glyphs');

    expect(found.length).toBeGreaterThan(0);
    // It has to name what was substituted, not just assert that something was.
    expect(found[0]?.message).toMatch(/does not supply/);
    expect(found[0]?.level).toBe('error');
  }, 180_000);

  it('stays quiet when the real webfont covers the copy, accents included', async () => {
    // The check is worthless if it cries wolf on a healthy render: Spanish
    // accents, inverted punctuation and all.
    const project = await loadProject({ configFile: await config('present', 'present') });
    const report = await doctor({ project });
    const found = report.diagnostics.filter((d) => d.code === 'font/missing-glyphs');

    expect(found).toEqual([]);
  }, 180_000);
});
