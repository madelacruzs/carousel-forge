import path from 'node:path';
import type { Carousel, Slide } from '../content/schema.js';
import type { Narrative } from '../narrative/load.js';
import { assignRoles, budgetFor } from '../narrative/resolve.js';
import type { CopyBudget, NarrativeRole } from '../narrative/schema.js';
import { resolveLayout, type Theme } from '../theme/load.js';
import { mergeTokens, type Tokens } from '../theme/tokens.js';
import {
  assertAssetExists,
  inlineAsset,
  prepareImage,
  type PreparedImage,
} from '../image/prepare.js';
import { lines as splitLines } from '../util/text.js';

/**
 * The renderer's unit of work.
 *
 * A frame is a slide sampled at a point in time. In v1 every slide produces
 * exactly one frame at `t = 0`; a future video target produces many frames per
 * slide without the pipeline below it changing at all.
 */
export interface Frame {
  /** 0-based slide index. */
  slideIndex: number;
  /** 1-based slide number, as the audience counts them. */
  slideNumber: number;
  /** Total slides in the carousel. */
  total: number;
  /** Seconds into this slide. Always 0 in v1. */
  t: number;
  /** 0-based frame index across the whole carousel. Equals slideIndex in v1. */
  frameIndex: number;
  layout: string;
  role: NarrativeRole | null;
  budget: CopyBudget;
  slide: Slide;
  tokens: Tokens;
  context: TemplateContext;
  /** Images resolved for this frame, kept for pixel sampling in `doctor`. */
  images: { primary?: PreparedImage; secondary?: PreparedImage };
}

export interface TitleParts {
  before: string;
  mark: string;
  after: string;
}

/** Everything `template.html` can reference. Themes see nothing else. */
export interface TemplateContext {
  layout: string;
  role: string | null;
  index: number;
  indexLabel: string;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  numbering: boolean;
  overlay: number;

  eyebrow?: string;
  title?: string;
  titleLines: string[];
  titleParts?: TitleParts;
  highlight?: string;
  body?: string;
  bodyLines: string[];
  bullets: string[];
  cta?: string;
  note?: string;
  labelA?: string;
  labelB?: string;

  handle?: string;
  brandName?: string;
  url?: string;
  logo?: string;

  image?: string;
  imageB?: string;
  hasImage: boolean;
  hasImageB: boolean;

  canvas: { w: number; h: number };
  safeArea: { top: number; right: number; bottom: number; left: number };
}

export interface BuildFramesOptions {
  carousel: Carousel;
  theme: Theme;
  narrative?: Narrative | undefined;
  /** Directory relative asset paths resolve against (the carousel file's dir). */
  baseDir: string;
}

/** Split a title around the highlighted word, for themes with a highlight block. */
export function splitTitle(title: string, highlight: string | undefined): TitleParts | undefined {
  if (!highlight) return undefined;
  const index = title.toLowerCase().indexOf(highlight.toLowerCase());
  if (index < 0) return undefined;
  return {
    before: title.slice(0, index),
    mark: title.slice(index, index + highlight.length),
    after: title.slice(index + highlight.length),
  };
}

export function padIndex(value: number, total: number): string {
  const width = Math.max(2, String(total).length);
  return String(value).padStart(width, '0');
}

export async function buildFrames(options: BuildFramesOptions): Promise<Frame[]> {
  const { carousel, theme, narrative, baseDir } = options;
  const { canvas, safeArea } = theme.manifest;
  const assignments = assignRoles(narrative, carousel.slides);

  let logo: string | undefined;
  if (carousel.brand?.logo) {
    const file = await assertAssetExists(carousel.brand.logo, baseDir, 'Brand logo');
    logo = await inlineAsset(file);
  }

  const frames: Frame[] = [];
  for (let i = 0; i < carousel.slides.length; i += 1) {
    const slide = carousel.slides[i] as Slide;
    const role = assignments[i]?.role ?? null;

    const requestedLayout = slide.layout ?? role?.layout ?? carousel.defaults?.layout;
    const layout = resolveLayout(theme, requestedLayout);
    const tokens = mergeTokens(theme.manifest, carousel.brand, slide);

    const images: Frame['images'] = {};
    if (slide.image) {
      const file = await assertAssetExists(
        slide.image,
        baseDir,
        `Image for slide ${i + 1} (${path.basename(slide.image)})`,
      );
      images.primary = await prepareImage({
        file,
        target: canvas,
        focal: slide.focal ?? carousel.defaults?.focal ?? [0.5, 0.5],
      });
    }
    if (slide.imageB) {
      const file = await assertAssetExists(
        slide.imageB,
        baseDir,
        `Second image for slide ${i + 1}`,
      );
      images.secondary = await prepareImage({
        file,
        // Split layouts show two half-height panes.
        target: { w: canvas.w, h: Math.round(canvas.h / 2) },
        focal: slide.focalB ?? [0.5, 0.5],
      });
    }
    if (images.primary && slide.imageB) {
      // Re-crop the primary to the same half-height pane so the pair matches.
      images.primary = await prepareImage({
        file: images.primary.file,
        target: { w: canvas.w, h: Math.round(canvas.h / 2) },
        focal: slide.focal ?? [0.5, 0.5],
      });
    }

    const numbering = slide.numbering ?? carousel.defaults?.numbering ?? false;
    const overlay = slide.overlay ?? carousel.defaults?.overlay ?? 0.55;
    const title = slide.title;

    const context: TemplateContext = {
      layout,
      role: role?.id ?? null,
      index: i + 1,
      indexLabel: padIndex(i + 1, carousel.slides.length),
      total: carousel.slides.length,
      isFirst: i === 0,
      isLast: i === carousel.slides.length - 1,
      numbering,
      overlay,
      titleLines: splitLines(title),
      bodyLines: splitLines(slide.body),
      bullets: slide.bullets ?? [],
      hasImage: Boolean(images.primary),
      hasImageB: Boolean(images.secondary),
      canvas,
      safeArea,
    };

    if (slide.eyebrow !== undefined) context.eyebrow = slide.eyebrow;
    if (title !== undefined) context.title = title;
    if (slide.highlight !== undefined) context.highlight = slide.highlight;
    if (title && slide.highlight) {
      const parts = splitTitle(title, slide.highlight);
      if (parts) context.titleParts = parts;
    }
    if (slide.body !== undefined) context.body = slide.body;
    if (slide.cta !== undefined) context.cta = slide.cta;
    if (slide.note !== undefined) context.note = slide.note;
    if (slide.labelA !== undefined) context.labelA = slide.labelA;
    if (slide.labelB !== undefined) context.labelB = slide.labelB;
    if (carousel.brand?.handle !== undefined) context.handle = carousel.brand.handle;
    if (carousel.brand?.name !== undefined) context.brandName = carousel.brand.name;
    if (carousel.brand?.url !== undefined) context.url = carousel.brand.url;
    if (logo !== undefined) context.logo = logo;
    if (images.primary) context.image = images.primary.dataUri;
    if (images.secondary) context.imageB = images.secondary.dataUri;

    frames.push({
      slideIndex: i,
      slideNumber: i + 1,
      total: carousel.slides.length,
      t: 0,
      frameIndex: i,
      layout,
      role,
      budget: budgetFor(narrative, role),
      slide,
      tokens,
      context,
      images,
    });
  }

  return frames;
}
