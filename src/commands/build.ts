import { watch } from 'node:fs';
import path from 'node:path';
import { build, summarize, type BuildResult } from '../pipeline/build.js';
import { loadProject } from '../pipeline/context.js';
import { clearImageCache } from '../image/prepare.js';
import { clearTemplateCache } from '../render/html.js';
import { Renderer } from '../render/renderer.js';
import { formatForgeError, isForgeError } from '../errors.js';
import { displayPath } from '../util/fs.js';
import { log, pc } from '../util/log.js';

export interface BuildCommandOptions {
  configFile: string;
  outDir: string;
  watch?: boolean;
  offline?: boolean;
  contactSheet?: boolean;
  caption?: boolean;
}

function report(result: BuildResult): void {
  log.success(`built ${summarize(result)}`);
  log.info(pc.dim(`  ${displayPath(path.dirname(result.files[0] ?? ''))}/`));
}

export async function buildCommand(options: BuildCommandOptions): Promise<BuildResult> {
  const run = () =>
    build({
      configFile: options.configFile,
      outDir: options.outDir,
      ...(options.offline !== undefined ? { offline: options.offline } : {}),
      ...(options.contactSheet !== undefined ? { contactSheet: options.contactSheet } : {}),
      ...(options.caption !== undefined ? { caption: options.caption } : {}),
    });

  if (!options.watch) {
    const result = await run();
    report(result);
    return result;
  }

  // Watch mode keeps one browser alive across rebuilds; it is by far the
  // slowest thing to start.
  const renderer = await Renderer.launch();
  const projectDir = path.dirname(path.resolve(options.configFile));
  let building = false;
  let queued = false;

  const rebuild = async (): Promise<BuildResult | undefined> => {
    if (building) {
      queued = true;
      return undefined;
    }
    building = true;
    try {
      clearImageCache();
      clearTemplateCache();
      const project = await loadProject({
        configFile: options.configFile,
        ...(options.offline !== undefined ? { offline: options.offline } : {}),
      });
      const result = await build({
        configFile: options.configFile,
        outDir: options.outDir,
        project,
        renderer,
        ...(options.contactSheet !== undefined ? { contactSheet: options.contactSheet } : {}),
        ...(options.caption !== undefined ? { caption: options.caption } : {}),
      });
      report(result);
      return result;
    } catch (error) {
      if (isForgeError(error)) log.error(formatForgeError(error));
      else log.error((error as Error).message);
      return undefined;
    } finally {
      building = false;
      if (queued) {
        queued = false;
        void rebuild();
      }
    }
  };

  const first = await rebuild();
  log.info(pc.dim(`watching ${displayPath(projectDir)} — ctrl-c to stop`));

  let timer: NodeJS.Timeout | undefined;
  const outDir = path.resolve(options.outDir);
  const watcher = watch(projectDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const changed = path.resolve(projectDir, filename.toString());
    if (changed.startsWith(outDir)) return;
    if (changed.includes(`${path.sep}node_modules${path.sep}`)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 120);
  });

  await new Promise<void>((resolve) => {
    const stop = () => {
      watcher.close();
      void renderer.close().then(resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });

  return first ?? (await run());
}
