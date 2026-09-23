import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveOutDir } from '../src/util/fs.js';

describe('resolveOutDir', () => {
  it('puts the output next to the carousel file, not next to the shell', () => {
    const config = path.resolve('sandbox/demo/carousel.yaml');
    expect(resolveOutDir(config, undefined)).toBe(path.resolve('sandbox/demo/out'));
  });

  it('does not depend on the current working directory', () => {
    const config = path.resolve('sandbox/demo/carousel.yaml');
    const fromElsewhere = resolveOutDir(path.join('sandbox', 'demo', 'carousel.yaml'), undefined);
    expect(fromElsewhere).toBe(resolveOutDir(config, undefined));
  });

  it('honours an explicit --out relative to the shell', () => {
    const config = path.resolve('sandbox/demo/carousel.yaml');
    expect(resolveOutDir(config, 'renders')).toBe(path.resolve('renders'));
  });

  it('honours an absolute --out untouched', () => {
    const target = path.resolve('/tmp/carousel-out');
    expect(resolveOutDir(path.resolve('a/carousel.yaml'), target)).toBe(target);
  });
});
