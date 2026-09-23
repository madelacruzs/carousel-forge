import { z } from 'zod';

const dimension = z.number().int().positive();

export const canvasSchema = z
  .object({
    w: dimension,
    h: dimension,
  })
  .strict();

export const safeAreaSchema = z
  .object({
    top: z.number().min(0),
    right: z.number().min(0),
    bottom: z.number().min(0),
    left: z.number().min(0),
  })
  .strict();

export const fontRequestSchema = z
  .object({
    family: z.string().min(1),
    weights: z.array(z.number().int().min(100).max(900)).min(1).default([400]),
    styles: z.array(z.enum(['normal', 'italic'])).min(1).default(['normal']),
  })
  .strict();

/**
 * Optional motion declaration. v1 validates this and then ignores it entirely;
 * it exists so that a future VideoTarget has something to read without any
 * change to the content format or the render pipeline.
 */
export const motionSchema = z
  .object({
    /** Seconds each slide is held. */
    duration: z.number().positive().optional(),
    fps: z.number().int().positive().max(120).optional(),
    /** Named transition between slides, interpreted by a future video target. */
    transition: z.string().min(1).optional(),
    /** Per-slot entrance animations. */
    slots: z
      .record(
        z.string(),
        z
          .object({
            in: z.string().min(1).optional(),
            out: z.string().min(1).optional(),
            delay: z.number().min(0).optional(),
            duration: z.number().positive().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const themeSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    canvas: canvasSchema.default({ w: 1080, h: 1350 }),
    safeArea: safeAreaSchema.default({ top: 80, right: 72, bottom: 120, left: 72 }),
    tokens: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
    slots: z.array(z.string().min(1)).default([]),
    layouts: z.array(z.string().min(1)).min(1).default(['default']),
    /** Google Fonts this theme needs. Downloaded once and cached locally. */
    fonts: z.array(fontRequestSchema).default([]),
    /** Advisory line budgets, surfaced by `doctor` and by the skill. */
    lineBudget: z
      .record(z.string(), z.object({ maxLines: z.number().int().positive() }).strict())
      .optional(),
    motion: motionSchema.optional(),
  })
  .strict();

export type Canvas = z.infer<typeof canvasSchema>;
export type SafeArea = z.infer<typeof safeAreaSchema>;
export type FontRequest = z.infer<typeof fontRequestSchema>;
export type Motion = z.infer<typeof motionSchema>;
export type ThemeManifest = z.infer<typeof themeSchema>;
