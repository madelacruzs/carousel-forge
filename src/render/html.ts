import Handlebars from 'handlebars';
import { ForgeError } from '../errors.js';
import { displayPath } from '../util/fs.js';
import path from 'node:path';
import { tokensToCss } from '../theme/tokens.js';
import type { Theme } from '../theme/load.js';
import type { Frame } from './frame.js';

/**
 * Handlebars is used with escaping left on. Themes are trusted markup, slide
 * copy is not, so anything coming out of `carousel.yaml` is escaped.
 */
function createHandlebars(): typeof Handlebars {
  const hb = Handlebars.create();

  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
  hb.registerHelper('gt', (a: number, b: number) => a > b);
  hb.registerHelper('lt', (a: number, b: number) => a < b);
  hb.registerHelper('not', (a: unknown) => !a);
  hb.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
  hb.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(Boolean));
  hb.registerHelper('upper', (value: unknown) => String(value ?? '').toUpperCase());
  hb.registerHelper('lower', (value: unknown) => String(value ?? '').toLowerCase());
  hb.registerHelper('pad', (value: number, width = 2) => String(value).padStart(width, '0'));
  hb.registerHelper('inc', (value: number) => Number(value) + 1);

  return hb;
}

const handlebars = createHandlebars();
const templateCache = new Map<string, HandlebarsTemplateDelegate>();

export function compileTemplate(source: string, themeName: string): HandlebarsTemplateDelegate {
  const cached = templateCache.get(`${themeName}:${source.length}:${source.slice(0, 64)}`);
  if (cached) return cached;
  try {
    const compiled = handlebars.compile(source, { strict: false, noEscape: false });
    templateCache.set(`${themeName}:${source.length}:${source.slice(0, 64)}`, compiled);
    return compiled;
  } catch (error) {
    throw new ForgeError(`Could not compile template: ${(error as Error).message}`, {
      where: `in theme "${themeName}"`,
      hint: 'check for an unclosed {{#if}} / {{#each}} block in template.html.',
    });
  }
}

export function clearTemplateCache(): void {
  templateCache.clear();
}

/**
 * Structural CSS owned by core. Deliberately contains no design decisions:
 * it sizes the canvas, exposes the safe area and the frame's images as custom
 * properties, and gets out of the way.
 */
function baseCss(): string {
  return `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: geometricPrecision; }
body {
  width: var(--canvas-w);
  height: var(--canvas-h);
  overflow: hidden;
  background: #000;
}
#cf-canvas {
  position: relative;
  width: var(--canvas-w);
  height: var(--canvas-h);
  overflow: hidden;
}
img { display: block; max-width: 100%; }
`.trim();
}

function frameCss(frame: Frame): string {
  const { canvas, safeArea } = frame.context;
  const declarations: string[] = [
    `--canvas-w: ${canvas.w}px`,
    `--canvas-h: ${canvas.h}px`,
    `--safe-top: ${safeArea.top}px`,
    `--safe-right: ${safeArea.right}px`,
    `--safe-bottom: ${safeArea.bottom}px`,
    `--safe-left: ${safeArea.left}px`,
    `--overlay-strength: ${frame.context.overlay}`,
    `--slide-index: ${frame.slideNumber}`,
    `--slide-total: ${frame.total}`,
  ];
  if (frame.context.image) declarations.push(`--image: url("${frame.context.image}")`);
  if (frame.context.imageB) declarations.push(`--image-b: url("${frame.context.imageB}")`);
  return `:root {\n${declarations.map((d) => `  ${d};`).join('\n')}\n}`;
}

export interface FrameDocumentOptions {
  frame: Frame;
  theme: Theme;
  /** `@font-face` rules with the font bytes already inlined. */
  fontCss: string;
}

/** Assemble the full HTML document handed to Chromium for one frame. */
export function renderFrameHtml(options: FrameDocumentOptions): string {
  const { frame, theme, fontCss } = options;
  const template = compileTemplate(theme.template, theme.manifest.name);

  let markup: string;
  try {
    markup = template(frame.context);
  } catch (error) {
    throw new ForgeError(`Could not render template: ${(error as Error).message}`, {
      where: `on slide ${frame.slideNumber} with theme "${theme.manifest.name}"`,
      hint: `check ${displayPath(path.join(theme.dir, 'template.html'))}.`,
    });
  }

  return `<!doctype html>
<html lang="en" data-layout="${escapeAttribute(frame.layout)}" data-role="${escapeAttribute(frame.context.role ?? '')}">
<head>
<meta charset="utf-8">
<title>slide ${frame.slideNumber}</title>
<style>${fontCss}</style>
<style>${tokensToCss(frame.tokens)}</style>
<style>${frameCss(frame)}</style>
<style>${baseCss()}</style>
<style>${theme.css}</style>
</head>
<body class="layout-${escapeAttribute(frame.layout)}${frame.context.role ? ` role-${escapeAttribute(frame.context.role)}` : ''}">
<div id="cf-canvas">
${markup}
</div>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}
