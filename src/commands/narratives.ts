import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ForgeError } from '../errors.js';
import { listNarratives, loadHooks, resolveNarrativeFile } from '../narrative/load.js';
import { repeatRange, slideCountRange } from '../narrative/resolve.js';
import { loadNarrative } from '../narrative/load.js';
import { displayPath, ensureDir, pathExists, readText, writeText } from '../util/fs.js';
import { log, pc } from '../util/log.js';

export async function narrativesListCommand(projectDir: string, verbose = false): Promise<void> {
  const narratives = await listNarratives(projectDir);
  if (narratives.length === 0) {
    log.warn('no narratives found.');
    return;
  }
  for (const listing of narratives) {
    const origin = listing.builtin ? pc.dim('built-in') : pc.green('project');
    log.info(`${pc.bold(listing.name)}  ${origin}`);
    log.info(`  ${listing.description}`);
    if (verbose) {
      try {
        const narrative = await loadNarrative(listing.name, projectDir);
        const range = slideCountRange(narrative);
        log.info(
          pc.dim(
            `  ${range.min === range.max ? `${range.min} slides` : `${range.min}-${range.max} slides`}`,
          ),
        );
        for (const role of narrative.manifest.roles) {
          const { min, max } = repeatRange(role);
          const count = min === max ? `x${min}` : `x${min}-${max}`;
          log.info(
            `  ${pc.cyan(role.id.padEnd(12))} ${pc.dim(count.padEnd(7))} ${role.purpose}` +
              (role.layout ? pc.dim(` → layout "${role.layout}"`) : ''),
          );
        }
      } catch {
        log.warn('  (could not be parsed)');
      }
    } else {
      log.info(pc.dim(`  roles: ${listing.roleIds.join(' → ')}`));
    }
    log.info('');
  }
}

export async function hooksListCommand(projectDir: string): Promise<void> {
  const hooks = await loadHooks(projectDir);
  if (hooks.length === 0) {
    log.warn('no hooks found.');
    return;
  }
  log.info(pc.dim('hook formulas — fill the {slots} with specifics from the brief'));
  log.info('');
  for (const hook of hooks) {
    log.info(`${pc.bold(hook.id)}`);
    log.info(`  ${hook.pattern}`);
    const tags = [
      ...(hook.works_for.length > 0 ? [`works for: ${hook.works_for.join(', ')}`] : []),
      ...(hook.visual ? [`needs a "${hook.visual}" layout`] : []),
    ];
    if (tags.length > 0) log.info(pc.dim(`  ${tags.join(' · ')}`));
    log.info('');
  }
}

export interface NarrativesNewOptions {
  projectDir: string;
  name: string;
  from: string;
  force?: boolean;
}

export async function narrativesNewCommand(options: NarrativesNewOptions): Promise<void> {
  const { projectDir, name } = options;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new ForgeError(`"${name}" is not a valid narrative name.`, {
      hint: 'use lowercase letters, digits and dashes, e.g. "viral-5".',
    });
  }
  if (name === 'hooks') {
    throw new ForgeError('"hooks" is reserved for the hook formula file.');
  }

  const target = path.join(projectDir, 'narratives', `${name}.yaml`);
  if ((await pathExists(target)) && !options.force) {
    throw new ForgeError(`${displayPath(target)} already exists.`, {
      hint: 'pass --force to overwrite it, or pick another name.',
    });
  }

  const { file: source } = await resolveNarrativeFile(options.from, projectDir);
  const contents = await readText(source);
  await ensureDir(path.dirname(target));
  await writeText(
    target,
    contents
      .replace(/^name:\s*.+$/m, `name: ${name}`)
      .replace(/^description:\s*.+$/m, `description: Derived from ${options.from}.`),
  );
  await fs.stat(target);

  log.success(`created ${displayPath(target)} from "${options.from}"`);
  log.info('');
  log.info(`edit the roles, then set ${pc.cyan(`narrative: ${name}`)} in carousel.yaml.`);
}
