import { z } from 'zod';

export const slotBudgetSchema = z
  .object({
    maxWords: z.number().int().min(0).optional(),
    maxLines: z.number().int().min(0).optional(),
    maxItems: z.number().int().min(0).optional(),
    maxWordsPerItem: z.number().int().min(0).optional(),
  })
  .strict();

export const copyBudgetSchema = z.record(z.string(), slotBudgetSchema);

export const roleSchema = z
  .object({
    id: z.string().min(1),
    /** Why this slide exists. Shown by `narratives list` and used by the skill. */
    purpose: z.string().min(1),
    /**
     * Layout hint. Resolved against the theme's declared layouts; if the theme
     * does not offer it, core falls back to `default`. A narrative never
     * requires a specific theme.
     */
    layout: z.string().min(1).optional(),
    /** Guidance for the copywriter (the agent), never used for rendering. */
    tone: z.string().optional(),
    /** Example copy, shown by `narratives list` and by the skill. */
    example: z.string().optional(),
    /** Per-slot copy budgets, enforced by `doctor`. */
    copy: copyBudgetSchema.optional(),
    /** Slots this role should not be missing. */
    requires: z.array(z.string().min(1)).default([]),
    /** How many slides may take this role. */
    repeat: z
      .union([
        z.number().int().min(0),
        z.object({ min: z.number().int().min(0), max: z.number().int().min(1) }).strict(),
      ])
      .default(1),
    /** `end` pins the role to the tail of the carousel, whatever the slide count. */
    anchor: z.enum(['start', 'end']).optional(),
  })
  .strict();

export const narrativeSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    /** What this structure is trying to achieve, in one line. */
    goal: z.string().optional(),
    /** Hook ids from hooks.yaml that suit this narrative. Advisory only. */
    hooks: z.array(z.string().min(1)).default([]),
    /** Default budgets applied to any role that does not override them. */
    defaults: z.object({ copy: copyBudgetSchema.optional() }).strict().optional(),
    roles: z.array(roleSchema).min(1),
  })
  .strict();

export const hookSchema = z
  .object({
    id: z.string().min(1),
    /** Pattern with `{slot}` placeholders the agent fills in. */
    pattern: z.string().min(1),
    /** Content types this formula suits, e.g. educational, personal. */
    works_for: z.array(z.string().min(1)).default([]),
    /** Layout hint when the hook implies a particular visual, e.g. `split`. */
    visual: z.string().min(1).optional(),
    /** A filled-in specimen, so an agent can see what "specific" looks like. */
    example: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const hooksFileSchema = z.union([
  z.array(hookSchema),
  z.object({ hooks: z.array(hookSchema) }).strict(),
]);

export type SlotBudget = z.infer<typeof slotBudgetSchema>;
export type CopyBudget = z.infer<typeof copyBudgetSchema>;
export type NarrativeRole = z.infer<typeof roleSchema>;
export type NarrativeManifest = z.infer<typeof narrativeSchema>;
export type Hook = z.infer<typeof hookSchema>;
