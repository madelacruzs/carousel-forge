#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { buildCommand } from './commands/build.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import {
  hooksListCommand,
  narrativesListCommand,
  narrativesNewCommand,
} from './commands/narratives.js';
import { previewCommand } from './commands/preview.js';
import { themesListCommand, themesNewCommand } from './commands/themes.js';
import { formatForgeError, isForgeError } from './errors.js';
import { log, setQuiet } from './util/log.js';
import { packageRoot } from './util/fs.js';

const require = createRequire(import.meta.url);
const pkg = require(path.join(packageRoot(), 'package.json')) as { version: string };

function resolveConfig(value: string | undefined): string {
  return path.resolve(value ?? 'carousel.yaml');
}

function projectDirOf(configFile: string): string {
  return path.dirname(configFile);
}

const program = new Command();

program
  .name('carousel-forge')
  .description(
    'Generate Instagram carousels from a YAML file, your photos and a theme.\n' +
      'Theme decides how it looks. Narrative decides what it says.',
  )
  .version(pkg.version)
  .option('-q, --quiet', 'only print warnings and errors')
  .hook('preAction', (command) => {
    if (command.opts().quiet) setQuiet(true);
  });

program
  .command('init')
  .description('scaffold carousel.yaml, images/ and assets/ in the current directory')
  .option('-d, --dir <path>', 'directory to scaffold into', '.')
  .option('-t, --theme <name>', 'theme to start from', 'warm-editorial')
  .option('-n, --narrative <name>', 'narrative to start from', 'viral-5')
  .option('--no-samples', 'do not write placeholder photos')
  .option('-f, --force', 'overwrite an existing carousel.yaml')
  .action(async (options) => {
    await initCommand({
      dir: options.dir,
      theme: options.theme,
      narrative: options.narrative,
      force: Boolean(options.force),
      noSamples: options.samples === false,
    });
  });

program
  .command('build')
  .description('render every slide to PNG, plus a contact sheet and a caption scaffold')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .option('-o, --out <dir>', 'output directory', 'out')
  .option('-w, --watch', 'rebuild whenever a file changes')
  .option('--offline', 'never reach for the network, even for uncached fonts')
  .option('--no-contact-sheet', 'skip out/contact-sheet.png')
  .option('--no-caption', 'skip out/caption.md')
  .action(async (options) => {
    await buildCommand({
      configFile: resolveConfig(options.config),
      outDir: path.resolve(options.out),
      watch: Boolean(options.watch),
      offline: Boolean(options.offline),
      contactSheet: options.contactSheet !== false,
      caption: options.caption !== false,
    });
  });

program
  .command('preview')
  .description('build, then serve the slides and contact sheet on localhost')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .option('-o, --out <dir>', 'output directory', 'out')
  .option('-p, --port <number>', 'port to listen on', '4321')
  .option('--no-rebuild', 'serve whatever is already in the output directory')
  .option('--offline', 'never reach for the network, even for uncached fonts')
  .action(async (options) => {
    await previewCommand({
      configFile: resolveConfig(options.config),
      outDir: path.resolve(options.out),
      port: Number(options.port),
      rebuild: options.rebuild !== false,
      offline: Boolean(options.offline),
    });
  });

program
  .command('doctor')
  .description('lint the carousel: layout, contrast, images, and the copy itself')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .option('--quick', 'skip the checks that need a browser')
  .option('--json', 'machine-readable output')
  .option('--offline', 'never reach for the network, even for uncached fonts')
  .action(async (options) => {
    const code = await doctorCommand({
      configFile: resolveConfig(options.config),
      quick: Boolean(options.quick),
      json: Boolean(options.json),
      offline: Boolean(options.offline),
    });
    process.exitCode = code;
  });

const themes = program.command('themes').description('inspect and create themes (how it looks)');

themes
  .command('list', { isDefault: true })
  .description('list every available theme')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .action(async (options) => {
    await themesListCommand(projectDirOf(resolveConfig(options.config)));
  });

themes
  .command('new <name>')
  .description('copy an existing theme into themes/<name> so you can change it')
  .option('--from <existing>', 'theme to copy', 'warm-editorial')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .option('-f, --force', 'overwrite an existing directory')
  .action(async (name, options) => {
    await themesNewCommand({
      projectDir: projectDirOf(resolveConfig(options.config)),
      name,
      from: options.from,
      force: Boolean(options.force),
    });
  });

const narratives = program
  .command('narratives')
  .description('inspect and create narratives (what it says, and in what order)');

narratives
  .command('list', { isDefault: true })
  .description('list every available narrative')
  .option('-v, --verbose', 'show each role, its purpose and its copy budget')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .action(async (options) => {
    await narrativesListCommand(
      projectDirOf(resolveConfig(options.config)),
      Boolean(options.verbose),
    );
  });

narratives
  .command('new <name>')
  .description('copy an existing narrative into narratives/<name>.yaml')
  .option('--from <existing>', 'narrative to copy', 'viral-5')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .option('-f, --force', 'overwrite an existing file')
  .action(async (name, options) => {
    await narrativesNewCommand({
      projectDir: projectDirOf(resolveConfig(options.config)),
      name,
      from: options.from,
      force: Boolean(options.force),
    });
  });

narratives
  .command('hooks')
  .description('list the hook formulas available to open a carousel with')
  .option('-c, --config <path>', 'path to carousel.yaml', 'carousel.yaml')
  .action(async (options) => {
    await hooksListCommand(projectDirOf(resolveConfig(options.config)));
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (isForgeError(error)) {
      log.error(formatForgeError(error));
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
