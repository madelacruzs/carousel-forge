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

const STOP_WORDS_EN = new Set([
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

/**
 * Spanish function words. Written without accents because `contentTokens` folds
 * accents before the lookup, so "mas" here also covers "más".
 *
 * A few entries overlap with English and are deliberate:
 * - "no", "me", "a" are function words in both languages, so stripping them costs
 *   nothing on the English side.
 * - "son" and "he" are function words in Spanish ("they are", "I have") but can be
 *   nouns or pronouns in English. They are still stripped: this set only feeds the
 *   similarity comparison in `copy/no-new-information`, never a word budget, so the
 *   worst case is that two English slides look slightly less similar than they are.
 *   A false negative there is much cheaper than the false positive it fixes.
 * Lexical verbs ("ser", "estar", "hacer", "tener") are left out on purpose — they
 * carry meaning and dropping them would hide real repetition.
 */
const STOP_WORDS_ES = new Set([
  'al',
  'algo',
  'aunque',
  'cada',
  'como',
  'con',
  'cual',
  'cuando',
  'cuanto',
  'de',
  'del',
  'desde',
  'donde',
  'e',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'entre',
  'era',
  'eran',
  'eres',
  'es',
  'esa',
  'esas',
  'ese',
  'eso',
  'esos',
  'esta',
  'estas',
  'este',
  'esto',
  'estos',
  'fue',
  'fueron',
  'ha',
  'han',
  'hasta',
  'hay',
  'he',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mas',
  'me',
  'mi',
  'mis',
  'mucho',
  'muy',
  'ni',
  'no',
  'nos',
  'nosotros',
  'o',
  'otra',
  'otro',
  'para',
  'pero',
  'poco',
  'por',
  'porque',
  'que',
  'quien',
  'se',
  'segun',
  'ser',
  'si',
  'sin',
  'sobre',
  'solo',
  'son',
  'su',
  'sus',
  'tambien',
  'tan',
  'te',
  'toda',
  'todas',
  'todo',
  'todos',
  'tu',
  'tus',
  'un',
  'una',
  'unas',
  'unos',
  'y',
  'ya',
  'yo',
]);

/**
 * English and Spanish are merged into one set rather than picked per carousel.
 * Same stance as `CTA_PATTERNS` in `doctor/hooks.ts`: dumb literal lists, not
 * language detection. To support another language, add its function words here.
 */
const STOP_WORDS = new Set([...STOP_WORDS_EN, ...STOP_WORDS_ES]);

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const N_TILDE = '\u0001';

/**
 * Strip diacritics so "mas"/"más" and "pais"/"país" compare as one token. "ñ" is
 * preserved, because it is a distinct letter and folding it would conflate
 * "año" with "ano". The leading NFC pass matters: in decomposed input "ñ" is
 * already n + U+0303, so the sentinel would never match and the tilde would be
 * stripped with the rest. ASCII input is unchanged, so the English path is
 * untouched.
 */
function foldAccents(token: string): string {
  return token
    .normalize('NFC')
    .replace(/ñ/g, N_TILDE)
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(new RegExp(N_TILDE, 'g'), 'ñ');
}

/**
 * Content-bearing tokens: tokens minus very common English and Spanish function
 * words, accent-folded. Used only for similarity comparisons — never for counting
 * words against a budget, which is what `words()`/`wordCount()` are for.
 */
export function contentTokens(text: string | undefined | null): Set<string> {
  const set = new Set<string>();
  for (const word of words(text)) {
    const folded = foldAccents(word.toLowerCase());
    if (!STOP_WORDS.has(folded)) set.add(folded);
  }
  return set;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
