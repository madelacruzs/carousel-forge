import { z } from 'zod';

/** Hex colour, e.g. `#E8C47A` or `#fff`. */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, {
    message: 'expected a hex colour such as "#E8C47A"',
  });

/**
 * Focal point of a photo, as fractions of width and height.
 * `[0, 0]` is the top-left corner, `[1, 1]` the bottom-right, `[0.5, 0.5]` the centre.
 */
export const focalSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
  .describe('focal point as [x, y] fractions between 0 and 1');

export const brandSchema = z
  .object({
    logo: z.string().min(1).optional(),
    handle: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    accent: hexColor.optional(),
    ink: hexColor.optional(),
    /** Free-form token overrides merged over the theme's tokens. */
    tokens: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .strict();

export const defaultsSchema = z
  .object({
    overlay: z.number().min(0).max(1).optional(),
    numbering: z.boolean().optional(),
    layout: z.string().min(1).optional(),
    focal: focalSchema.optional(),
  })
  .strict();

/** Slots a slide may fill. Unknown keys are rejected so typos surface early. */
export const slideSchema = z
  .object({
    /** Role from the selected narrative. Optional: roles are assigned positionally otherwise. */
    role: z.string().min(1).optional(),
    /** Explicit theme layout. Overrides whatever the narrative role would pick. */
    layout: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
    focal: focalSchema.optional(),
    overlay: z.number().min(0).max(1).optional(),
    eyebrow: z.string().optional(),
    title: z.string().optional(),
    body: z.string().optional(),
    /** Bulleted points. Themes render these as a list when present. */
    bullets: z.array(z.string().min(1)).optional(),
    cta: z.string().optional(),
    /** Small print rendered under the main copy by themes that support it. */
    note: z.string().optional(),
    /** Highlighted word within the title, used by themes with a highlight block. */
    highlight: z.string().min(1).optional(),
    /** Second image for split layouts. */
    imageB: z.string().min(1).optional(),
    focalB: focalSchema.optional(),
    /** Labels for the two halves of a split layout. */
    labelA: z.string().optional(),
    labelB: z.string().optional(),
    numbering: z.boolean().optional(),
    /** Per-slide token overrides, merged last. */
    tokens: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .strict();

export const captionSchema = z
  .object({
    /** Free-form caption text. `build` scaffolds this file; the agent fills it in. */
    text: z.string().optional(),
    hashtags: z
      .object({
        broad: z.array(z.string()).optional(),
        niche: z.array(z.string()).optional(),
        branded: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    firstComment: z.string().optional(),
  })
  .strict();

export const carouselSchema = z
  .object({
    theme: z.string().min(1, 'a theme name is required, e.g. "warm-editorial"'),
    narrative: z.string().min(1).optional(),
    brand: brandSchema.optional(),
    defaults: defaultsSchema.optional(),
    caption: captionSchema.optional(),
    slides: z
      .array(slideSchema)
      .min(1, 'a carousel needs at least one slide')
      .max(20, 'Instagram allows at most 20 slides in a carousel'),
  })
  .strict();

export type Focal = z.infer<typeof focalSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type Defaults = z.infer<typeof defaultsSchema>;
export type Slide = z.infer<typeof slideSchema>;
export type CaptionConfig = z.infer<typeof captionSchema>;
export type Carousel = z.infer<typeof carouselSchema>;

/** Slot names core knows about. Themes declare which subset they actually render. */
export const KNOWN_SLOTS = [
  'eyebrow',
  'title',
  'body',
  'bullets',
  'cta',
  'note',
  'index',
  'logo',
  'handle',
  'highlight',
  'labelA',
  'labelB',
] as const;

export type KnownSlot = (typeof KNOWN_SLOTS)[number];
