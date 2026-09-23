import path from 'node:path';
import { renderContactSheet } from '../render/contactSheet.js';
import { Renderer, type RenderedFrame } from '../render/renderer.js';
import { PngTarget } from '../render/targets/png.js';
import type { OutputTarget } from '../render/targets/target.js';
import { displayPath, readText, pathExists, writeBinary, writeText } from '../util/fs.js';
import { log } from '../util/log.js';
import {
  captionIsPristine,
  outlineDelta,
  renderCaptionScaffold,
  renderSlideOutline,
} from './caption.js';
import { loadProject, type ProjectContext } from './context.js';

export interface BuildOptions {
  configFile: string;
  outDir: string;
  /** Extra targets alongside the PNG target. */
  targets?: OutputTarget[];
  contactSheet?: boolean;
  caption?: boolean;
  /** Overwrite `caption.md` even if it has been written in. */
  forceCaption?: boolean;
  offline?: boolean;
  /** Reuse an already-loaded project (watch mode) or an open browser. */
  project?: ProjectContext;
  renderer?: Renderer;
}

export interface BuildResult {
  project: ProjectContext;
  rendered: RenderedFrame[];
  files: string[];
  contactSheetFile?: string;
  captionFile?: string;
  outlineFile?: string;
  /** True when an edited `caption.md` was left alone instead of regenerated. */
  captionPreserved?: boolean;
  durationMs: number;
}

/**
 * Render every frame and hand each one to every output target.
 *
 * The loop below knows nothing about PNGs: it builds frames and pushes them
 * through `OutputTarget`. That is the seam a future video target plugs into.
 */
export async function build(options: BuildOptions): Promise<BuildResult> {
  const started = Date.now();
  const project =
    options.project ??
    (await loadProject({
      configFile: options.configFile,
      ...(options.offline !== undefined ? { offline: options.offline } : {}),
    }));

  const outDir = path.resolve(options.outDir);
  const targets: OutputTarget[] = [new PngTarget({ outDir }), ...(options.targets ?? [])];

  const ownRenderer = !options.renderer;
  const renderer = options.renderer ?? (await Renderer.launch());

  try {
    for (const target of targets) {
      await target.begin?.({ theme: project.theme, frameCount: project.frames.length, outDir });
    }

    const rendered: RenderedFrame[] = [];
    for (const frame of project.frames) {
      const result = await renderer.render(frame, project.theme, project.fontCss);
      rendered.push(result);
      for (const target of targets) await target.write(result);
      log.step(`slide ${frame.slideNumber}/${frame.total} · ${frame.layout}`);
    }

    const files: string[] = [];
    for (const target of targets) {
      const result = await target.finalize?.();
      if (result) files.push(...result.files);
    }

    let contactSheetFile: string | undefined;
    if (options.contactSheet !== false && rendered.length > 0) {
      const sheet = await renderContactSheet({ slides: rendered.map((r) => r.png) });
      contactSheetFile = path.join(outDir, 'contact-sheet.png');
      await writeBinary(contactSheetFile, sheet);
      files.push(contactSheetFile);
    }

    let captionFile: string | undefined;
    let outlineFile: string | undefined;
    let captionPreserved = false;
    if (options.caption !== false) {
      // The outline is derived from the slides, so it is always rewritten.
      outlineFile = path.join(outDir, 'slide-outline.md');
      const outline = renderSlideOutline(project.carousel.data, project.frames);
      const previousOutline = (await pathExists(outlineFile)) ? await readText(outlineFile) : '';
      await writeText(outlineFile, outline);
      files.push(outlineFile);

      captionFile = path.join(outDir, 'caption.md');
      const existing = (await pathExists(captionFile)) ? await readText(captionFile) : undefined;
      const writable =
        existing === undefined || options.forceCaption === true || captionIsPristine(existing);

      if (writable) {
        await writeText(captionFile, renderCaptionScaffold(project.carousel.data));
      } else {
        // Someone wrote a caption here. A rebuild after tweaking one slide must
        // not cost them that. Say so, and say what moved underneath them.
        captionPreserved = true;
        const changed = previousOutline ? outlineDelta(previousOutline, outline) : undefined;
        const note =
          changed === undefined
            ? 'There is no previous slide outline to compare against, so it may be stale.'
            : changed.length > 0
              ? 'The slides have changed since it was written, so it may now be stale:\n' +
                changed.map((line) => `    ${line}`).join('\n')
              : 'The slide outline is unchanged.';
        log.warn(
          `${displayPath(captionFile)} has been edited, so it was left untouched. ${note}` +
            `\n    Run \`build --force-caption\` to replace it with a fresh scaffold.`,
        );
      }
      files.push(captionFile);
    }

    return {
      project,
      rendered,
      files,
      ...(contactSheetFile ? { contactSheetFile } : {}),
      ...(captionFile ? { captionFile } : {}),
      ...(outlineFile ? { outlineFile } : {}),
      ...(captionPreserved ? { captionPreserved } : {}),
      durationMs: Date.now() - started,
    };
  } finally {
    if (ownRenderer) await renderer.close();
  }
}

export function summarize(result: BuildResult): string {
  const pngs = result.files.filter((f) => f.endsWith('.png') && !f.endsWith('contact-sheet.png'));
  const parts = [`${pngs.length} slide${pngs.length === 1 ? '' : 's'}`];
  if (result.contactSheetFile) parts.push(displayPath(result.contactSheetFile));
  if (result.captionFile) parts.push(displayPath(result.captionFile));
  return `${parts.join(' · ')} in ${(result.durationMs / 1000).toFixed(1)}s`;
}
