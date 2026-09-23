import path from 'node:path';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import { formatZodError } from '../content/load.js';
import { ForgeError } from '../errors.js';
import { displayPath, listFiles, packageRoot, pathExists, readText } from '../util/fs.js';
import { hooksFileSchema, narrativeSchema, type Hook, type NarrativeManifest } from './schema.js';

export interface Narrative {
  manifest: NarrativeManifest;
  file: string;
  builtin: boolean;
}

export interface NarrativeSource {
  dir: string;
  builtin: boolean;
}

/** Project narratives shadow built-in ones of the same name. */
export function narrativeSearchPaths(projectDir: string): NarrativeSource[] {
  return [
    { dir: path.join(projectDir, 'narratives'), builtin: false },
    { dir: path.join(packageRoot(), 'narratives'), builtin: true },
  ];
}

const RESERVED = new Set(['hooks']);

function parseYamlFile(source: string, file: string): unknown {
  try {
    return parseYaml(source);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const line = error.linePos?.[0]?.line;
      throw new ForgeError(
        `Could not parse YAML${line ? ` (line ${line})` : ''}: ${error.message.split('\n')[0]}`,
        { where: `in ${displayPath(file)}` },
      );
    }
    throw error;
  }
}

async function readNarrative(file: string): Promise<NarrativeManifest> {
  const raw = parseYamlFile(await readText(file), file);
  const result = narrativeSchema.safeParse(raw);
  if (!result.success) throw formatZodError(result.error, `in ${displayPath(file)}`);
  return result.data;
}

export interface NarrativeListing {
  name: string;
  file: string;
  builtin: boolean;
  description: string;
  roleIds: string[];
}

export async function listNarratives(projectDir: string): Promise<NarrativeListing[]> {
  const seen = new Map<string, NarrativeListing>();
  for (const source of narrativeSearchPaths(projectDir)) {
    for (const entry of await listFiles(source.dir)) {
      if (!/\.ya?ml$/i.test(entry)) continue;
      const name = entry.replace(/\.ya?ml$/i, '');
      if (RESERVED.has(name) || seen.has(name)) continue;
      const file = path.join(source.dir, entry);
      try {
        const manifest = await readNarrative(file);
        seen.set(name, {
          name,
          file,
          builtin: source.builtin,
          description: manifest.description,
          roleIds: manifest.roles.map((r) => r.id),
        });
      } catch {
        seen.set(name, {
          name,
          file,
          builtin: source.builtin,
          description: '(could not be parsed)',
          roleIds: [],
        });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveNarrativeFile(
  name: string,
  projectDir: string,
): Promise<{ file: string; builtin: boolean }> {
  for (const source of narrativeSearchPaths(projectDir)) {
    for (const ext of ['.yaml', '.yml']) {
      const file = path.join(source.dir, `${name}${ext}`);
      if (await pathExists(file)) return { file, builtin: source.builtin };
    }
  }
  const available = (await listNarratives(projectDir)).map((n) => n.name);
  throw new ForgeError(`Unknown narrative "${name}".`, {
    hint:
      available.length > 0
        ? `available narratives: ${available.join(', ')}. Run \`carousel-forge narratives list\` for details.`
        : 'no narratives found. Run `carousel-forge narratives new <name>` to create one.',
  });
}

export async function loadNarrative(name: string, projectDir: string): Promise<Narrative> {
  const { file, builtin } = await resolveNarrativeFile(name, projectDir);
  const manifest = await readNarrative(file);
  if (manifest.name !== name) {
    throw new ForgeError(
      `Narrative file "${path.basename(file)}" declares the name "${manifest.name}".`,
      {
        where: `in ${displayPath(file)}`,
        hint: `rename the file to "${manifest.name}.yaml", or set name: ${name}.`,
      },
    );
  }
  const ids = new Set<string>();
  for (const role of manifest.roles) {
    if (ids.has(role.id)) {
      throw new ForgeError(`Duplicate role id "${role.id}".`, {
        where: `in ${displayPath(file)}`,
        hint: 'role ids must be unique within a narrative; use repeat to allow several slides per role.',
      });
    }
    ids.add(role.id);
  }
  return { manifest, file, builtin };
}

/** Load `narratives/hooks.yaml`, preferring the project's copy over the built-in one. */
export async function loadHooks(projectDir: string): Promise<Hook[]> {
  for (const source of narrativeSearchPaths(projectDir)) {
    for (const ext of ['.yaml', '.yml']) {
      const file = path.join(source.dir, `hooks${ext}`);
      if (!(await pathExists(file))) continue;
      const raw = parseYamlFile(await readText(file), file);
      const result = hooksFileSchema.safeParse(raw);
      if (!result.success) throw formatZodError(result.error, `in ${displayPath(file)}`);
      return Array.isArray(result.data) ? result.data : result.data.hooks;
    }
  }
  return [];
}
