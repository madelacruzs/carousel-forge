import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  detectHook,
  looksLikeCta,
  patternToRegex,
  thumbnailFontSize,
} from '../src/doctor/hooks.js';
import { loadHooks } from '../src/narrative/load.js';

const NO_PROJECT = path.join(os.tmpdir(), 'carousel-forge-tests-empty-project');

describe('patternToRegex', () => {
  it('matches a filled-in formula', () => {
    const re = patternToRegex('{n} things I wish I knew before {topic}');
    expect(re.test('5 things i wish i knew before i started')).toBe(true);
    expect(re.test('12 things I wish I knew before buying a house')).toBe(true);
  });

  it('does not match copy that only shares a few words', () => {
    const re = patternToRegex('{n} things I wish I knew before {topic}');
    expect(re.test('things to know')).toBe(false);
    expect(re.test('i wish')).toBe(false);
  });

  it('treats regex metacharacters in a pattern as literal text', () => {
    const re = patternToRegex("you're doing {thing} wrong. here's why.");
    expect(re.test("you're doing lighting wrong. here's why.")).toBe(true);
    expect(re.test("you're doing lighting wrongXhere'sZwhy!")).toBe(false);
  });
});

describe('detectHook', () => {
  it('names the formula a headline follows', async () => {
    const hooks = await loadHooks(NO_PROJECT);
    const match = detectHook('5 things i wish i knew before i started', hooks);
    expect(match.matched).toBe(true);
    expect(match.hookId).toBe('wish-i-knew');
  });

  it('every shipped hook example matches its own pattern', async () => {
    const hooks = await loadHooks(NO_PROJECT);
    for (const hook of hooks) {
      if (!hook.example) continue;
      const match = detectHook(hook.example, hooks);
      expect(match.matched, `${hook.id}: "${hook.example}" did not match any formula`).toBe(true);
    }
  });

  it('accepts a headline that carries a hook signal without matching a formula', () => {
    expect(detectHook('why is every rental kitchen beige?').signals).toContain('asks a question');
    expect(detectHook('stop painting everything white').matched).toBe(true);
    expect(detectHook('your ceiling is costing you photos').matched).toBe(true);
  });

  it('rejects a flat descriptive label', () => {
    for (const flat of ['our new kitchen', 'project update', 'spring collection 2026']) {
      expect(detectHook(flat).matched, flat).toBe(false);
    }
  });

  it('treats an empty title as no hook rather than throwing', () => {
    expect(detectHook(undefined)).toEqual({ matched: false, signals: [] });
    expect(detectHook('   ').matched).toBe(false);
  });
});

describe('looksLikeCta', () => {
  it('recognises an ask', () => {
    expect(looksLikeCta('save this post')).toBe(true);
    expect(looksLikeCta(undefined, 'send this to someone who needs it')).toBe(true);
    expect(looksLikeCta('link in bio')).toBe(true);
  });

  it('does not count a closing statement as an ask', () => {
    expect(looksLikeCta('that is all we learned')).toBe(false);
    expect(looksLikeCta('')).toBe(false);
    expect(looksLikeCta()).toBe(false);
  });
});

describe('thumbnailFontSize', () => {
  it('scales type down to the grid preview width', () => {
    expect(thumbnailFontSize(108, 1080)).toBeCloseTo(16);
    expect(thumbnailFontSize(27, 1080)).toBeCloseTo(4);
  });

  it('is canvas-relative, so a theme with a different canvas is judged fairly', () => {
    expect(thumbnailFontSize(216, 2160)).toBeCloseTo(thumbnailFontSize(108, 1080));
  });
});
