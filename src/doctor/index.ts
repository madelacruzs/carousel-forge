import { loadHooks } from '../narrative/load.js';
import type { ProjectContext } from '../pipeline/context.js';
import { Renderer, type RenderedFrame } from '../render/renderer.js';
import { auditCopy } from './copy.js';
import { auditLayout } from './layout.js';
import { summarizeDiagnostics, type Diagnostic, type DoctorReport } from './types.js';

export * from './types.js';
export { auditCopy } from './copy.js';
export { auditLayout } from './layout.js';
export { detectHook, looksLikeCta, patternToRegex } from './hooks.js';

export interface DoctorOptions {
  project: ProjectContext;
  /** Frames already rendered by a build. Rendered on demand when absent. */
  rendered?: RenderedFrame[];
  /** Skip the layout audit, which needs a browser. */
  skipLayout?: boolean;
}

const ORDER: Record<Diagnostic['level'], number> = { error: 0, warn: 1, info: 2 };

/** Run the full lint: layout against the rendered pixels, copy against the source. */
export async function doctor(options: DoctorOptions): Promise<DoctorReport> {
  const { project } = options;
  const diagnostics: Diagnostic[] = [];

  const hooks = await loadHooks(project.projectDir);
  diagnostics.push(...auditCopy(project, hooks));

  if (!options.skipLayout) {
    let rendered = options.rendered;
    if (!rendered) {
      const renderer = await Renderer.launch();
      try {
        rendered = [];
        for (const frame of project.frames) {
          rendered.push(
            await renderer.render(frame, project.theme, project.fontCss, { backdrop: true }),
          );
        }
      } finally {
        await renderer.close();
      }
    }
    diagnostics.push(...(await auditLayout(project, rendered)));
  }

  diagnostics.sort((a, b) => {
    const bySlide = (a.slide ?? 0) - (b.slide ?? 0);
    if (bySlide !== 0) return bySlide;
    return ORDER[a.level] - ORDER[b.level];
  });

  return summarizeDiagnostics(diagnostics);
}
