import path from 'node:path';
import { renderContactSheet } from '../render/contactSheet.js';
import { Renderer, type RenderedFrame } from '../render/renderer.js';
import { PngTarget } from '../render/targets/png.js';
import type { OutputTarget } from '../render/targets/target.js';
import { displayPath, writeBinary, writeText } from '../util/fs.js';
import { log } from '../util/log.js';
import { renderCaptionScaffold } from './caption.js';
import { loadProject, type ProjectContext } from './context.js';

export interface BuildOptions {
  configFile: string;
  outDir: string;
  /** Extra targets alongside the PNG target. */
  targets?: OutputTarget[];
  contactSheet?: boolean;
  caption?: boolean;
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
    if (options.caption !== false) {
      captionFile = path.join(outDir, 'caption.md');
      await writeText(captionFile, renderCaptionScaffold(project.carousel.data, project.frames));
      files.push(captionFile);
    }

    return {
      project,
      rendered,
      files,
      ...(contactSheetFile ? { contactSheetFile } : {}),
      ...(captionFile ? { captionFile } : {}),
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
