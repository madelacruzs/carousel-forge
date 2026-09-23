import path from 'node:path';
import { doctor } from '../doctor/index.js';
import type { Diagnostic } from '../doctor/types.js';
import { loadProject } from '../pipeline/context.js';
import { log, pc } from '../util/log.js';

export interface DoctorCommandOptions {
  configFile: string;
  /** Skip the checks that need a browser. */
  quick?: boolean;
  offline?: boolean;
  json?: boolean;
}

const BADGE: Record<Diagnostic['level'], string> = {
  error: pc.red('error'),
  warn: pc.yellow(' warn'),
  info: pc.blue(' info'),
};

export async function doctorCommand(options: DoctorCommandOptions): Promise<number> {
  const project = await loadProject({
    configFile: options.configFile,
    ...(options.offline !== undefined ? { offline: options.offline } : {}),
  });

  const report = await doctor({
    project,
    ...(options.quick ? { skipLayout: true } : {}),
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.errors > 0 ? 1 : 0;
  }

  log.info(
    `${pc.bold(path.basename(project.carousel.file))} · theme ${pc.cyan(project.theme.manifest.name)}` +
      (project.narrative ? ` · narrative ${pc.cyan(project.narrative.manifest.name)}` : '') +
      ` · ${project.frames.length} slides`,
  );
  log.info('');

  if (report.diagnostics.length === 0) {
    log.success('nothing to fix.');
    return 0;
  }

  let currentSlide: number | undefined = -1;
  for (const diagnostic of report.diagnostics) {
    if (diagnostic.slide !== currentSlide) {
      currentSlide = diagnostic.slide;
      log.info(pc.dim(currentSlide ? `slide ${currentSlide}` : 'carousel'));
    }
    log.info(`  ${BADGE[diagnostic.level]} ${pc.dim(diagnostic.code)}  ${diagnostic.message}`);
    if (diagnostic.hint) log.info(`         ${pc.dim(diagnostic.hint)}`);
  }

  log.info('');
  const parts: string[] = [];
  if (report.errors) parts.push(pc.red(`${report.errors} error${report.errors === 1 ? '' : 's'}`));
  if (report.warnings) parts.push(pc.yellow(`${report.warnings} warning${report.warnings === 1 ? '' : 's'}`));
  if (report.infos) parts.push(pc.blue(`${report.infos} note${report.infos === 1 ? '' : 's'}`));
  log.info(parts.join(' · '));

  return report.errors > 0 ? 1 : 0;
}
