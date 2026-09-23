import type { Brand, Slide } from '../content/schema.js';
import type { ThemeManifest } from './schema.js';

export type TokenValue = string | number;
export type Tokens = Record<string, TokenValue>;

/** Convert a token name to a CSS custom property name: `fontDisplay` -> `--font-display`. */
export function tokenToCssVar(name: string): string {
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
  return `--${kebab}`;
}

/**
 * Merge token layers. Later layers win. Precedence, lowest to highest:
 * theme defaults < brand shorthands < brand.tokens < slide.tokens.
 *
 * Nothing here knows what any individual token means — that is the theme's job.
 */
export function mergeTokens(
  theme: ThemeManifest,
  brand?: Brand,
  slide?: Pick<Slide, 'tokens'>,
): Tokens {
  const merged: Tokens = { ...theme.tokens };

  if (brand) {
    if (brand.accent !== undefined) merged.accent = brand.accent;
    if (brand.ink !== undefined) merged.ink = brand.ink;
    if (brand.tokens) Object.assign(merged, brand.tokens);
  }
  if (slide?.tokens) Object.assign(merged, slide.tokens);

  return merged;
}

/** Render tokens as a `:root { ... }` block of CSS custom properties. */
export function tokensToCss(tokens: Tokens, selector = ':root'): string {
  const declarations = Object.entries(tokens)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `  ${tokenToCssVar(name)}: ${String(value)};`)
    .join('\n');
  return `${selector} {\n${declarations}\n}`;
}
