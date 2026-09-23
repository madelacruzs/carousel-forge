import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function readText(file: string): Promise<string> {
  return fs.readFile(file, 'utf8');
}

export async function writeText(file: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, contents, 'utf8');
}

export async function writeBinary(file: string, contents: Buffer | Uint8Array): Promise<void> {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, contents);
}

export function sha256(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Normalise a path for display: relative to cwd, POSIX separators. */
export function displayPath(target: string, from: string = process.cwd()): string {
  const rel = path.relative(from, target);
  if (!rel || rel.startsWith('..')) return target.split(path.sep).join('/');
  return rel.split(path.sep).join('/');
}

/**
 * Root of the installed package, used to locate the built-in `themes/` and
 * `narratives/` directories regardless of whether we run from `src` or `dist`.
 */
/**
 * Output belongs next to the carousel it came from, not next to wherever the
 * user happened to be standing. Building `-c ../other/carousel.yaml` and having
 * the slides land in the current directory is a quiet way to review stale PNGs
 * while believing they are fresh. An explicit `--out` is taken at face value
 * and stays relative to the shell.
 */
export function resolveOutDir(configFile: string, explicit: string | undefined): string {
  if (explicit === undefined) return path.join(path.dirname(path.resolve(configFile)), 'out');
  return path.resolve(explicit);
}

export function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

/** List immediate subdirectory names of `dir`, or `[]` when it does not exist. */
export async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** List immediate file names of `dir`, or `[]` when it does not exist. */
export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}
