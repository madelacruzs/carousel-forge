import path from 'node:path';
import { loadCarousel, type LoadedCarousel } from '../content/load.js';
import { loadNarrative, type Narrative } from '../narrative/load.js';
import { loadTheme, type Theme } from '../theme/load.js';
import { ensureGoogleFonts, fontFaceCss, themeFontFaces } from '../fonts/google.js';
import { buildFrames, type Frame } from '../render/frame.js';

export interface ProjectContext {
  carousel: LoadedCarousel;
  theme: Theme;
  narrative?: Narrative;
  frames: Frame[];
  /** `@font-face` rules with font bytes inlined, shared by every frame. */
  fontCss: string;
  /** Directory the carousel file lives in. */
  projectDir: string;
}

export interface LoadProjectOptions {
  /** Path to `carousel.yaml`. */
  configFile: string;
  /** Skip network access when fonts are not already cached. */
  offline?: boolean;
}

/**
 * Everything both `build` and `doctor` need: content, theme, narrative, fonts
 * and the resolved frames. Kept in one place so the two commands can never
 * disagree about what would be rendered.
 */
export async function loadProject(options: LoadProjectOptions): Promise<ProjectContext> {
  const carousel = await loadCarousel(options.configFile);
  const projectDir = carousel.dir;

  const theme = await loadTheme(carousel.data.theme, projectDir);
  const narrative = carousel.data.narrative
    ? await loadNarrative(carousel.data.narrative, projectDir)
    : undefined;

  const faces = [
    ...(options.offline ? [] : await ensureGoogleFonts(theme.manifest.fonts)),
    ...(await themeFontFaces(theme.dir)),
  ];
  const fontCss = await fontFaceCss(faces);

  const frames = await buildFrames({
    carousel: carousel.data,
    theme,
    narrative,
    baseDir: projectDir,
  });

  return {
    carousel,
    theme,
    ...(narrative ? { narrative } : {}),
    frames,
    fontCss,
    projectDir,
  };
}

export function defaultConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, 'carousel.yaml');
}
