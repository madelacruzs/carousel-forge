/** Text measurement helpers shared by the doctor's copy audit and the caption scaffold. */

/** Split a string into words, ignoring punctuation-only tokens. */
export function words(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((w) => w.length > 0);
}

export function wordCount(text: string | undefined | null): number {
  return words(text).length;
}

/** Lines of a multi-line slot value, trimmed, with blanks removed. */
export function lines(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function charCount(text: string | undefined | null): number {
  return (text ?? '').replace(/\s+/g, ' ').trim().length;
}

/** Lowercase, punctuation-stripped tokens used for redundancy comparisons. */
export function tokenSet(text: string | undefined | null): Set<string> {
  return new Set(words(text).map((w) => w.toLowerCase()));
}

/** Jaccard similarity between two token sets: 0 = disjoint, 1 = identical. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
  'you',
  'your',
]);

/** Content-bearing tokens, i.e. tokens minus very common English stop words. */
export function contentTokens(text: string | undefined | null): Set<string> {
  const set = new Set<string>();
  for (const word of words(text)) {
    const lower = word.toLowerCase();
    if (!STOP_WORDS.has(lower)) set.add(lower);
  }
  return set;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
