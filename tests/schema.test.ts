import { describe, expect, it } from 'vitest';
import { parseCarousel } from '../src/content/load.js';
import { isForgeError } from '../src/errors.js';

/** Parse and return the ForgeError, failing the test if the input was accepted. */
function expectRejected(yaml: string): { message: string; hint?: string; where?: string } {
  try {
    parseCarousel(yaml, '/project/carousel.yaml');
  } catch (error) {
    if (!isForgeError(error)) throw error;
    return { message: error.message, ...error };
  }
  throw new Error('expected the carousel to be rejected, but it parsed');
}

const MINIMAL = `
theme: warm-editorial
slides:
  - title: "hello"
`;

describe('carousel schema', () => {
  it('accepts a minimal carousel', () => {
    const data = parseCarousel(MINIMAL, '/p/carousel.yaml');
    expect(data.theme).toBe('warm-editorial');
    expect(data.slides).toHaveLength(1);
    expect(data.slides[0]?.title).toBe('hello');
  });

  it('accepts the full documented shape', () => {
    const data = parseCarousel(
      `
theme: warm-editorial
narrative: viral-5
brand:
  logo: assets/logo.svg
  handle: "@elmike.ca"
  name: "el mike"
  url: "elmike.ca"
  accent: "#E8C47A"
  tokens:
    titleSize: "96px"
defaults:
  overlay: 0.55
  numbering: true
slides:
  - image: photos/kitchen.jpg
    focal: [0.4, 0.3]
    title: "the kona home"
    body: "not a venue. a home."
    bullets: ["one", "two"]
    highlight: "home"
    tokens:
      accent: "#FF0000"
  - role: cta
    layout: cta
    title: "coming soon"
    cta: "save this post"
    note: "more soon"
`,
      '/p/carousel.yaml',
    );
    expect(data.brand?.handle).toBe('@elmike.ca');
    expect(data.slides[0]?.focal).toEqual([0.4, 0.3]);
    expect(data.slides[1]?.role).toBe('cta');
  });

  it('requires at least one slide', () => {
    expect(expectRejected('theme: warm-editorial\nslides: []').message).toMatch(/slides/);
  });

  it('refuses more than 20 slides, because Instagram does', () => {
    const slides = Array.from({ length: 21 }, (_, i) => `  - title: "s${i}"`).join('\n');
    expect(expectRejected(`theme: warm-editorial\nslides:\n${slides}`).message).toMatch(/slides/);
  });

  it('names the offending slide and field', () => {
    const error = expectRejected(`
theme: warm-editorial
slides:
  - title: "fine"
  - title: "fine"
  - title: "fine"
  - overlay: 4
`);
    expect(error.message).toContain('slides[3].overlay');
  });

  it('explains what focal is supposed to look like', () => {
    const error = expectRejected(`
theme: warm-editorial
slides:
  - image: a.jpg
    focal: [0.4]
`);
    expect(error.message).toContain('slides[0].focal');
    expect(error.hint).toMatch(/focal: \[0\.4, 0\.3\]/);
  });

  it('rejects an out-of-range focal point', () => {
    expect(expectRejected(`theme: t\nslides:\n  - focal: [1.4, 0.3]`).message).toContain('focal');
  });

  it('rejects unknown slide fields rather than silently ignoring them', () => {
    const error = expectRejected(`
theme: warm-editorial
slides:
  - titel: "typo"
`);
    expect(error.message).toContain('"titel"');
    expect(error.hint).toMatch(/Known slide fields/);
  });

  it('rejects unknown top-level fields', () => {
    expect(expectRejected(`theme: t\nthemes: t\nslides:\n  - title: a`).message).toContain(
      '"themes"',
    );
  });

  it('rejects a colour that is not hex, and says why quoting matters', () => {
    const error = expectRejected(`
theme: t
brand:
  accent: "rebeccapurple"
slides:
  - title: a
`);
    expect(error.message).toContain('brand.accent');
    expect(error.hint).toMatch(/#E8C47A/);
  });

  it('reports the line number for malformed YAML', () => {
    const error = expectRejected('theme: warm-editorial\nslides:\n  - title: "unclosed\n');
    expect(error.message).toMatch(/Could not parse YAML/);
    expect(error.hint).toMatch(/indentation/);
  });

  it('tells an empty file what to do next', () => {
    const error = expectRejected('# just a comment\n');
    expect(error.message).toMatch(/empty/);
    expect(error.hint).toMatch(/carousel-forge init/);
  });

  it('points at the file it was reading', () => {
    expect(expectRejected('theme: t\nslides: []').where).toContain('carousel.yaml');
  });
});
