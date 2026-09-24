import { describe, expect, it } from 'vitest';
import { contentTokens, jaccard, wordCount, words } from '../src/util/text.js';

/**
 * The stop-word list as it was before Spanish was added. Kept here so the
 * regression this file guards against stays legible: these are the scores the
 * doctor used to produce.
 */
const ENGLISH_ONLY_STOP_WORDS = new Set([
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

function englishOnlyContentTokens(text: string): Set<string> {
  return new Set(
    words(text)
      .map((w) => w.toLowerCase())
      .filter((w) => !ENGLISH_ONLY_STOP_WORDS.has(w)),
  );
}

/** The threshold `copy/no-new-information` fires at in src/doctor/copy.ts. */
const REDUNDANCY_THRESHOLD = 0.6;

describe('contentTokens', () => {
  it('strips English function words', () => {
    expect([...contentTokens('the cost of the move is in the paperwork')]).toEqual([
      'cost',
      'move',
      'paperwork',
    ]);
  });

  it('strips Spanish function words', () => {
    expect([...contentTokens('el papeleo no es lo que te va a costar más caro')]).toEqual([
      'papeleo',
      'va',
      'costar',
      'caro',
    ]);
  });

  it('folds accents so más and mas are one token', () => {
    expect(contentTokens('el alquiler sube más')).toEqual(contentTokens('el alquiler sube mas'));
    expect([...contentTokens('el país')]).toEqual(['pais']);
  });

  it('keeps ñ, which is a letter and not an accent', () => {
    expect([...contentTokens('el año')]).toEqual(['año']);
    expect(contentTokens('año')).not.toEqual(contentTokens('ano'));
  });

  // The YAML Miguel writes on Windows arrives composed, but creator-studio reads
  // copy back out of a database through its bridge, and macOS produces decomposed
  // text on several paths. Composed input passes even when the fold is broken, so
  // the decomposed form is the case worth pinning down.
  it('keeps ñ when the input is decomposed rather than composed', () => {
    const decomposed = 'año'.normalize('NFD');
    expect(decomposed).not.toBe('año');
    expect(contentTokens(decomposed)).toEqual(contentTokens('año'));
    expect(contentTokens(decomposed)).not.toEqual(contentTokens('ano'));
  });

  it('folds ordinary accents the same way whichever normal form arrives', () => {
    expect(contentTokens('más país'.normalize('NFD'))).toEqual(contentTokens('mas pais'));
  });

  it('leaves ASCII English copy exactly as the English-only list did', () => {
    const english = 'the rent is not the thing that drains your savings here';
    expect(contentTokens(english)).toEqual(englishOnlyContentTokens(english));
  });
});

describe('copy/no-new-information similarity', () => {
  // Two slides of a "lo que no te dicen de X" carousel: same deliberate frame,
  // genuinely different subject. The English-only list counted every function
  // word as content and scored them as near-duplicates.
  const slideA = 'lo que no te dicen de la plata en vancouver';
  const slideB = 'lo que no te dicen de la gente en canada';

  it('used to cross the threshold on Spanish slides that are not redundant', () => {
    const before = jaccard(englishOnlyContentTokens(slideA), englishOnlyContentTokens(slideB));
    expect(before).toBeGreaterThanOrEqual(REDUNDANCY_THRESHOLD);
  });

  it('no longer crosses the threshold', () => {
    const after = jaccard(contentTokens(slideA), contentTokens(slideB));
    expect(after).toBeLessThan(REDUNDANCY_THRESHOLD);
  });

  it('still catches a Spanish slide that really does repeat the one before it', () => {
    const repeated = jaccard(
      contentTokens('la renta te come el sueldo en vancouver'),
      contentTokens('en vancouver la renta se come todo el sueldo'),
    );
    expect(repeated).toBeGreaterThanOrEqual(REDUNDANCY_THRESHOLD);
  });

  it('leaves English slides scoring as they always did', () => {
    const a = 'the first winter is the one that breaks people';
    const b = 'the first winter is the one that breaks everyone';
    expect(jaccard(contentTokens(a), contentTokens(b))).toBe(
      jaccard(englishOnlyContentTokens(a), englishOnlyContentTokens(b)),
    );
  });
});

describe('word budgets are unaffected', () => {
  it('counts function words and keeps accents, because budgets measure the real line', () => {
    expect(wordCount('el país de los años que no vuelven')).toBe(8);
    expect(words('más años')).toEqual(['más', 'años']);
  });
});
