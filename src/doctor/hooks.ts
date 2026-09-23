import type { Hook } from '../narrative/schema.js';
import { words } from '../util/text.js';

/**
 * Mechanical hook detection.
 *
 * This flags and explains; it never rewrites. Deciding that a headline is weak
 * and writing a better one is the agent's job, not the CLI's — the CLI has no
 * language model and anything it invented would read like spam.
 */

export interface HookMatch {
  matched: boolean;
  /** Id of the hooks.yaml formula that matched, when one did. */
  hookId?: string;
  /** Names of the generic signals that fired. */
  signals: string[];
}

/** Turn a `{slot}` pattern into a loose regular expression. */
export function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withSlots = escaped.replace(/\\\{[a-z0-9_]+\\\}/gi, '.{1,60}?');
  return new RegExp(`^\\s*${withSlots}\\s*$`, 'i');
}

const SIGNALS: { name: string; test: (text: string) => boolean }[] = [
  {
    name: 'opens with a number',
    test: (t) => /^\s*\d+\b/.test(t),
  },
  {
    name: 'asks a question',
    test: (t) => /\?/.test(t),
  },
  {
    name: 'addresses the reader directly',
    test: (t) => /\b(you|your|you're|youre)\b/i.test(t),
  },
  {
    name: 'takes a contrarian position',
    test: (t) =>
      /\b(stop|quit|never|don't|dont|avoid|nobody|no one|instead|actually|wrong|myth|overrated)\b/i.test(
        t,
      ),
  },
  {
    name: 'promises a payoff',
    test: (t) =>
      /\b(how to|here's|heres|why|what|secret|mistake|lesson|wish i|before you|things i)\b/i.test(
        t,
      ),
  },
  {
    name: 'sets up a contrast',
    test: (t) => /\bvs\.?\b|\bversus\b|\bbefore\b.*\bafter\b/i.test(t),
  },
];

/** Does slide 1 look like a hook rather than a flat descriptive label? */
export function detectHook(text: string | undefined, hooks: Hook[] = []): HookMatch {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return { matched: false, signals: [] };

  for (const hook of hooks) {
    if (patternToRegex(hook.pattern).test(value)) {
      return { matched: true, hookId: hook.id, signals: ['matches a hooks.yaml formula'] };
    }
  }

  const signals = SIGNALS.filter((signal) => signal.test(value)).map((s) => s.name);
  return { matched: signals.length > 0, signals };
}

const CTA_PATTERNS = [
  /\bsave\b/i,
  /\bshare\b/i,
  /\bfollow\b/i,
  /\bcomment\b/i,
  /\bdm\b/i,
  /\bsend\b/i,
  /\btap\b/i,
  /\blink in bio\b/i,
  /\bsubscribe\b/i,
  /\bjoin\b/i,
  /\bbook\b/i,
  /\bget\b.*\bfree\b/i,
  /\bswipe\b/i,
  /\breply\b/i,
];

/** Does this copy ask the reader to do something? */
export function looksLikeCta(...texts: (string | undefined)[]): boolean {
  const joined = texts.filter(Boolean).join(' ');
  if (!joined.trim()) return false;
  return CTA_PATTERNS.some((pattern) => pattern.test(joined));
}

/**
 * Rough readability score at thumbnail size: the smallest rendered type, scaled
 * down to the width Instagram uses in a grid preview.
 */
export function thumbnailFontSize(fontSize: number, canvasWidth: number, thumbWidth = 160): number {
  if (canvasWidth <= 0) return fontSize;
  return fontSize * (thumbWidth / canvasWidth);
}

/** Total words of visible copy on a slide. */
export function slideWordCount(texts: (string | undefined)[]): number {
  return texts.reduce((total, text) => total + words(text).length, 0);
}
