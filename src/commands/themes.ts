import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ForgeError } from '../errors.js';
import { listThemes, resolveThemeDir } from '../theme/load.js';
import { displayPath, ensureDir, pathExists, readText, writeText } from '../util/fs.js';
import { log, pc } from '../util/log.js';

export async function themesListCommand(projectDir: string): Promise<void> {
  const themes = await listThemes(projectDir);
  if (themes.length === 0) {
    log.warn('no themes found.');
    return;
  }
  for (const theme of themes) {
    const origin = theme.builtin ? pc.dim('built-in') : pc.green('project');
    log.info(`${pc.bold(theme.name)}  ${origin}`);
    if (theme.description) log.info(`  ${theme.description}`);
    log.info(pc.dim(`  layouts: ${theme.layouts.join(', ') || '(none)'}`));
    log.info(pc.dim(`  ${displayPath(theme.dir)}`));
    log.info('');
  }
}

async function copyDir(from: string, to: string): Promise<void> {
  await ensureDir(to);
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(source, destination);
    else if (entry.isFile()) await fs.copyFile(source, destination);
  }
}

export interface ThemesNewOptions {
  projectDir: string;
  name: string;
  from: string;
  force?: boolean;
}

export async function themesNewCommand(options: ThemesNewOptions): Promise<void> {
  const { projectDir, name } = options;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new ForgeError(`"${name}" is not a valid theme name.`, {
      hint: 'use lowercase letters, digits and dashes, e.g. "warm-editorial".',
    });
  }

  const target = path.join(projectDir, 'themes', name);
  if ((await pathExists(target)) && !options.force) {
    throw new ForgeError(`${displayPath(target)} already exists.`, {
      hint: 'pass --force to overwrite it, or pick another name.',
    });
  }

  const { dir: source } = await resolveThemeDir(options.from, projectDir);
  await copyDir(source, target);

  // Point the copy at its own name so it loads as a distinct theme.
  const manifestFile = path.join(target, 'theme.json');
  const manifest = JSON.parse(await readText(manifestFile));
  manifest.name = name;
  manifest.description = `Derived from ${options.from}.`;
  await writeText(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  // A preview belongs to the theme it was rendered from.
  const preview = path.join(target, 'preview.png');
  if (await pathExists(preview)) await fs.rm(preview);

  log.success(`created ${displayPath(target)} from "${options.from}"`);
  log.info('');
  log.info(
    `edit ${pc.cyan(`themes/${name}/theme.css`)}, then set ${pc.cyan(`theme: ${name}`)} in carousel.yaml.`,
  );
}
