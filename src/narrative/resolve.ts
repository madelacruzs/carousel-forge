import type { Narrative } from './load.js';
import type { CopyBudget, NarrativeRole, SlotBudget } from './schema.js';

export interface RepeatRange {
  min: number;
  max: number;
}

export function repeatRange(role: NarrativeRole): RepeatRange {
  if (typeof role.repeat === 'number') return { min: role.repeat, max: role.repeat };
  return { min: role.repeat.min, max: role.repeat.max };
}

/** Smallest and largest slide count this narrative can express. */
export function slideCountRange(narrative: Narrative): RepeatRange {
  let min = 0;
  let max = 0;
  for (const role of narrative.manifest.roles) {
    const range = repeatRange(role);
    min += range.min;
    max += range.max;
  }
  return { min, max };
}

/**
 * Expand a narrative's roles into one role id per slide.
 *
 * Roles anchored to `end` (typically the CTA) are placed last whatever the
 * slide count; the remaining slots are filled from the head roles, giving each
 * its minimum first and then distributing what is left over to the flexible
 * roles in declaration order.
 */
export function expandRoles(narrative: Narrative, slideCount: number): (NarrativeRole | null)[] {
  const roles = narrative.manifest.roles;
  const head = roles.filter((r) => r.anchor !== 'end');
  const tail = roles.filter((r) => r.anchor === 'end');

  const tailSeq: NarrativeRole[] = [];
  for (const role of tail) {
    const { min } = repeatRange(role);
    for (let i = 0; i < Math.max(min, 1); i += 1) tailSeq.push(role);
  }

  const headBudget = Math.max(0, slideCount - tailSeq.length);

  const counts = new Map<string, number>();
  let used = 0;
  for (const role of head) {
    const { min } = repeatRange(role);
    const take = Math.min(min, Math.max(0, headBudget - used));
    counts.set(role.id, take);
    used += take;
  }
  // Hand the leftover slides to whichever head roles still have room.
  let guard = 0;
  while (used < headBudget && guard < 1000) {
    guard += 1;
    let grew = false;
    for (const role of head) {
      if (used >= headBudget) break;
      const { max } = repeatRange(role);
      const current = counts.get(role.id) ?? 0;
      if (current < max) {
        counts.set(role.id, current + 1);
        used += 1;
        grew = true;
      }
    }
    if (!grew) break;
  }

  const headSeq: NarrativeRole[] = [];
  for (const role of head) {
    for (let i = 0; i < (counts.get(role.id) ?? 0); i += 1) headSeq.push(role);
  }

  const combined: (NarrativeRole | null)[] = [...headSeq, ...tailSeq];
  // More slides than the narrative describes: the surplus carries no role.
  while (combined.length < slideCount) combined.splice(combined.length - tailSeq.length, 0, null);
  return combined.slice(0, slideCount);
}

export interface RoleAssignment {
  /** Index of the slide this assignment belongs to. */
  slideIndex: number;
  role: NarrativeRole | null;
  /** `explicit` when the slide named its own role, `positional` otherwise. */
  source: 'explicit' | 'positional' | 'none';
}

/**
 * Assign a role to every slide. A slide's own `role:` field always wins; the
 * rest are filled positionally from the expanded narrative sequence.
 */
export function assignRoles(
  narrative: Narrative | undefined,
  slides: { role?: string | undefined }[],
): RoleAssignment[] {
  if (!narrative) {
    return slides.map((_, slideIndex) => ({ slideIndex, role: null, source: 'none' as const }));
  }
  const byId = new Map(narrative.manifest.roles.map((r) => [r.id, r]));
  const positional = expandRoles(narrative, slides.length);

  return slides.map((slide, slideIndex) => {
    if (slide.role) {
      const role = byId.get(slide.role) ?? null;
      return { slideIndex, role, source: 'explicit' as const };
    }
    const role = positional[slideIndex] ?? null;
    return { slideIndex, role, source: role ? ('positional' as const) : ('none' as const) };
  });
}

/** Merge narrative-level default budgets with the role's own budgets. */
export function budgetFor(
  narrative: Narrative | undefined,
  role: NarrativeRole | null,
): CopyBudget {
  const defaults: CopyBudget = narrative?.manifest.defaults?.copy ?? {};
  const own: CopyBudget = role?.copy ?? {};
  const merged: CopyBudget = {};
  for (const key of new Set([...Object.keys(defaults), ...Object.keys(own)])) {
    merged[key] = { ...(defaults[key] ?? {}), ...(own[key] ?? {}) } as SlotBudget;
  }
  return merged;
}
