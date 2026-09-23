import { describe, expect, it } from 'vitest';
import { mergeTokens, tokenToCssVar, tokensToCss } from '../src/theme/tokens.js';
import type { ThemeManifest } from '../src/theme/schema.js';

const theme: ThemeManifest = {
  name: 'test',
  canvas: { w: 1080, h: 1350 },
  safeArea: { top: 80, right: 72, bottom: 120, left: 72 },
  tokens: {
    accent: '#E8C47A',
    ink: '#FFFFFF',
    fontDisplay: 'Playfair Display',
    titleSize: '110px',
  },
  slots: ['title'],
  layouts: ['default'],
};

describe('tokenToCssVar', () => {
  it('kebab-cases camelCase token names', () => {
    expect(tokenToCssVar('fontDisplay')).toBe('--font-display');
    expect(tokenToCssVar('accent')).toBe('--accent');
    expect(tokenToCssVar('titleLeading')).toBe('--title-leading');
  });

  it('normalises separators so a theme can use any casing it likes', () => {
    expect(tokenToCssVar('font_body')).toBe('--font-body');
    expect(tokenToCssVar('image B')).toBe('--image-b');
  });
});

describe('mergeTokens', () => {
  it('returns the theme tokens untouched when nothing overrides them', () => {
    expect(mergeTokens(theme)).toEqual(theme.tokens);
  });

  it('does not mutate the theme manifest', () => {
    mergeTokens(theme, { accent: '#FF0000' });
    expect(theme.tokens.accent).toBe('#E8C47A');
  });

  it('lets brand shorthands override theme tokens', () => {
    const merged = mergeTokens(theme, { accent: '#FF0000', ink: '#111111' });
    expect(merged.accent).toBe('#FF0000');
    expect(merged.ink).toBe('#111111');
    expect(merged.fontDisplay).toBe('Playfair Display');
  });

  it('lets brand.tokens override brand shorthands', () => {
    const merged = mergeTokens(theme, {
      accent: '#FF0000',
      tokens: { accent: '#00FF00', titleSize: '90px' },
    });
    expect(merged.accent).toBe('#00FF00');
    expect(merged.titleSize).toBe('90px');
  });

  it('lets a slide override everything above it', () => {
    const merged = mergeTokens(
      theme,
      { accent: '#FF0000', tokens: { accent: '#00FF00' } },
      { tokens: { accent: '#0000FF' } },
    );
    expect(merged.accent).toBe('#0000FF');
  });

  it('carries through tokens the theme never declared', () => {
    const merged = mergeTokens(theme, { tokens: { myOwnThing: '3px' } });
    expect(merged.myOwnThing).toBe('3px');
  });
});

describe('tokensToCss', () => {
  it('emits a custom property per token', () => {
    const css = tokensToCss({ accent: '#E8C47A', fontDisplay: 'Playfair Display' });
    expect(css).toContain('--accent: #E8C47A;');
    expect(css).toContain('--font-display: Playfair Display;');
    expect(css.startsWith(':root {')).toBe(true);
  });

  it('sorts declarations so identical token sets produce identical CSS', () => {
    const a = tokensToCss({ b: '2', a: '1' });
    const b = tokensToCss({ a: '1', b: '2' });
    expect(a).toBe(b);
  });

  it('stringifies numeric tokens', () => {
    expect(tokensToCss({ overlay: 0.55 })).toContain('--overlay: 0.55;');
  });
});
