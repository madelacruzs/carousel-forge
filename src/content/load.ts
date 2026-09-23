import path from 'node:path';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { z } from 'zod';
import { ForgeError } from '../errors.js';
import { displayPath, pathExists, readText } from '../util/fs.js';
import { carouselSchema, type Carousel } from './schema.js';

/**
 * Turn a zod issue path into something a human recognises from their YAML file,
 * e.g. `slides[3].title` rather than `slides.3.title`.
 */
export function formatIssuePath(issuePath: readonly (string | number | symbol)[]): string {
  let out = '';
  for (const segment of issuePath) {
    if (typeof segment === 'number') out += `[${segment}]`;
    else if (out.length === 0) out += String(segment);
    else out += `.${String(segment)}`;
  }
  return out || '(root)';
}

function describeIssue(issue: z.ZodIssue): string {
  const where = formatIssuePath(issue.path);
  switch (issue.code) {
    case 'unrecognized_keys': {
      const keys = issue.keys.map((k) => `"${k}"`).join(', ');
      return `${where}: unknown field${issue.keys.length > 1 ? 's' : ''} ${keys}`;
    }
    case 'invalid_type':
      return `${where}: expected ${issue.expected}, received ${issue.received}`;
    default:
      return `${where}: ${issue.message}`;
  }
}

/** Extra guidance for the most common mistakes, keyed by the field that failed. */
function hintForIssue(issue: z.ZodIssue): string | undefined {
  const where = formatIssuePath(issue.path);
  if (issue.code === 'unrecognized_keys') {
    return `remove the unknown field, or check the spelling. Known slide fields: role, layout, image, focal, overlay, eyebrow, title, body, bullets, cta, note, highlight, imageB, focalB, labelA, labelB, numbering, tokens.`;
  }
  if (where.endsWith('focal') || where.endsWith('focalB')) {
    return 'focal is a pair of fractions, e.g. focal: [0.4, 0.3] — 0 is the left/top edge, 1 the right/bottom edge.';
  }
  if (where.endsWith('overlay')) {
    return 'overlay is a number between 0 (as light as the theme allows) and 1 (fully dark). Themes may floor it: warm-editorial keeps a minimum scrim so text stays legible, so 0 is not necessarily no darkening.';
  }
  if (where.endsWith('accent') || where.endsWith('ink')) {
    return 'colours are hex strings, e.g. "#E8C47A". Quote them so YAML does not read # as a comment.';
  }
  return undefined;
}

export function formatZodError(error: z.ZodError, where: string): ForgeError {
  const issues = error.issues.slice(0, 12);
  const body = issues.map((issue) => `  - ${describeIssue(issue)}`).join('\n');
  const more =
    error.issues.length > issues.length
      ? `\n  … and ${error.issues.length - issues.length} more problem(s)`
      : '';
  const hint = issues.map(hintForIssue).find((h): h is string => Boolean(h));
  return new ForgeError(`${issues.length === 1 ? 'Problem' : 'Problems'} found:\n${body}${more}`, {
    where,
    ...(hint ? { hint } : {}),
  });
}

export interface LoadedCarousel {
  /** Absolute path of the file that was read. */
  file: string;
  /** Directory the file lives in. All relative asset paths resolve against this. */
  dir: string;
  data: Carousel;
}

export function parseCarousel(source: string, file: string): Carousel {
  const where = `in ${displayPath(file)}`;
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      const line = error.linePos?.[0]?.line;
      throw new ForgeError(
        `Could not parse YAML${line ? ` (line ${line})` : ''}: ${error.message.split('\n')[0]}`,
        {
          where,
          hint: 'check indentation — YAML is whitespace sensitive — and quote any value containing a colon or a leading #.',
        },
      );
    }
    throw error;
  }

  if (raw === null || raw === undefined) {
    throw new ForgeError('The file is empty.', {
      where,
      hint: 'run `carousel-forge init` to scaffold a starter carousel.yaml.',
    });
  }

  const result = carouselSchema.safeParse(raw);
  if (!result.success) throw formatZodError(result.error, where);
  return result.data;
}

export async function loadCarousel(file: string): Promise<LoadedCarousel> {
  const absolute = path.resolve(file);
  if (!(await pathExists(absolute))) {
    throw new ForgeError(`No carousel file at ${displayPath(absolute)}.`, {
      hint: 'run `carousel-forge init` to create one, or pass --config <path>.',
    });
  }
  const source = await readText(absolute);
  return { file: absolute, dir: path.dirname(absolute), data: parseCarousel(source, absolute) };
}
