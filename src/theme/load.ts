import path from 'node:path';
import { ForgeError } from '../errors.js';
import { formatZodError } from '../content/load.js';
import { displayPath, listDirs, listFiles, packageRoot, pathExists, readText } from '../util/fs.js';
import { themeSchema, type ThemeManifest } from './schema.js';

export interface Theme {
  manifest: ThemeManifest;
  /** Absolute path of `themes/<name>/`. */
  dir: string;
  /** Raw Handlebars source of `template.html`. */
  template: string;
  /** Raw contents of `theme.css`. */
  css: string;
  /** `true` when the theme ships with the package rather than the user's project. */
  builtin: boolean;
}

export interface ThemeSource {
  dir: string;
  builtin: boolean;
}

/**
 * Directories searched for themes, in priority order. A theme in the user's
 * project shadows a built-in theme of the same name, which is how someone
 * customises `warm-editorial` without touching the package.
 */
export function themeSearchPaths(projectDir: string): ThemeSource[] {
  return [
    { dir: path.join(projectDir, 'themes'), builtin: false },
    { dir: path.join(packageRoot(), 'themes'), builtin: true },
  ];
}

export interface ThemeListing {
  name: string;
  dir: string;
  builtin: boolean;
  description?: string;
  layouts: string[];
}

export async function listThemes(projectDir: string): Promise<ThemeListing[]> {
  const seen = new Map<string, ThemeListing>();
  for (const source of themeSearchPaths(projectDir)) {
    for (const name of await listDirs(source.dir)) {
      if (seen.has(name)) continue;
      const dir = path.join(source.dir, name);
      if (!(await pathExists(path.join(dir, 'theme.json')))) continue;
      try {
        const manifest = await readManifest(dir);
        seen.set(name, {
          name,
          dir,
          builtin: source.builtin,
          ...(manifest.description ? { description: manifest.description } : {}),
          layouts: manifest.layouts,
        });
      } catch {
        seen.set(name, { name, dir, builtin: source.builtin, layouts: [] });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readManifest(dir: string): Promise<ThemeManifest> {
  const file = path.join(dir, 'theme.json');
  const source = await readText(file);
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new ForgeError(`Could not parse JSON: ${(error as Error).message}`, {
      where: `in ${displayPath(file)}`,
      hint: 'theme.json must be valid JSON — check for a trailing comma or an unquoted key.',
    });
  }
  const result = themeSchema.safeParse(raw);
  if (!result.success) throw formatZodError(result.error, `in ${displayPath(file)}`);
  return result.data;
}

export async function resolveThemeDir(
  name: string,
  projectDir: string,
): Promise<{ dir: string; builtin: boolean }> {
  for (const source of themeSearchPaths(projectDir)) {
    const dir = path.join(source.dir, name);
    if (await pathExists(path.join(dir, 'theme.json'))) {
      return { dir, builtin: source.builtin };
    }
  }
  const available = (await listThemes(projectDir)).map((t) => t.name);
  throw new ForgeError(`Unknown theme "${name}".`, {
    hint:
      available.length > 0
        ? `available themes: ${available.join(', ')}. Run \`carousel-forge themes list\` for details.`
        : 'no themes found. Run `carousel-forge themes new <name>` to create one.',
  });
}

export async function loadTheme(name: string, projectDir: string): Promise<Theme> {
  const { dir, builtin } = await resolveThemeDir(name, projectDir);
  const manifest = await readManifest(dir);

  if (manifest.name !== name) {
    throw new ForgeError(
      `Theme directory "${name}" declares the name "${manifest.name}" in theme.json.`,
      {
        where: `in ${displayPath(path.join(dir, 'theme.json'))}`,
        hint: `rename the directory to "${manifest.name}", or set "name": "${name}".`,
      },
    );
  }

  const templateFile = path.join(dir, 'template.html');
  const cssFile = path.join(dir, 'theme.css');
  for (const required of [templateFile, cssFile]) {
    if (!(await pathExists(required))) {
      const present = await listFiles(dir);
      throw new ForgeError(`Theme "${name}" is missing ${path.basename(required)}.`, {
        where: `in ${displayPath(dir)}`,
        hint: `a theme needs theme.json, template.html and theme.css. Found: ${present.join(', ') || '(nothing)'}.`,
      });
    }
  }

  return {
    manifest,
    dir,
    builtin,
    template: await readText(templateFile),
    css: await readText(cssFile),
  };
}

/**
 * Resolve a layout name against a theme. Unknown layouts fall back to
 * `default` rather than failing, so that any narrative composes with any theme.
 */
export function resolveLayout(theme: Theme, requested: string | undefined): string {
  if (requested && theme.manifest.layouts.includes(requested)) return requested;
  if (theme.manifest.layouts.includes('default')) return 'default';
  return theme.manifest.layouts[0] ?? 'default';
}
