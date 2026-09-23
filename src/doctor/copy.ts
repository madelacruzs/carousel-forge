import type { Hook } from '../narrative/schema.js';
import { slideCountRange } from '../narrative/resolve.js';
import type { ProjectContext } from '../pipeline/context.js';
import { contentTokens, jaccard, wordCount } from '../util/text.js';
import { detectHook, looksLikeCta, slideWordCount } from './hooks.js';
import type { Diagnostic } from './types.js';

/**
 * The copy audit. Every check here is mechanical and explains what is wrong;
 * none of them rewrite anything. Rewriting is the agent's job.
 */
export function auditCopy(project: ProjectContext, hooks: Hook[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { frames, narrative } = project;
  if (frames.length === 0) return diagnostics;

  // --- slide 1 has to stop the scroll -------------------------------------
  const first = frames[0]!;
  const hookText = [first.slide.title, first.slide.eyebrow].filter(Boolean).join(' ');
  const match = detectHook(hookText, hooks);
  if (!match.matched) {
    diagnostics.push({
      level: 'warn',
      code: 'copy/weak-hook',
      slide: 1,
      message:
        'Slide 1 reads like a descriptive label, not a hook. Nothing in it gives a reason to keep swiping.',
      hint: 'try a formula from narratives/hooks.yaml — open with a number, ask a question, address the reader as "you", or take a contrarian position.',
    });
  } else if (match.hookId) {
    diagnostics.push({
      level: 'info',
      code: 'copy/hook-matched',
      slide: 1,
      message: `Slide 1 follows the "${match.hookId}" hook formula.`,
    });
  }

  // --- the last slide has to ask for something ----------------------------
  const last = frames[frames.length - 1]!;
  if (!looksLikeCta(last.slide.cta, last.slide.title, last.slide.body, last.slide.note)) {
    diagnostics.push({
      level: 'warn',
      code: 'copy/no-cta',
      slide: last.slideNumber,
      message: 'The final slide does not ask the reader to do anything.',
      hint: 'add a cta: such as "save this for later" or "comment READY and I will send it over". Saves and comments are what the algorithm rewards.',
    });
  }

  // --- copy budgets from the narrative ------------------------------------
  for (const frame of frames) {
    const budget = frame.budget;
    if (Object.keys(budget).length === 0) continue;
    const role = frame.role?.id ?? 'this slide';

    for (const [slot, limits] of Object.entries(budget)) {
      const value = (frame.slide as Record<string, unknown>)[slot];

      if (slot === 'bullets' && Array.isArray(value)) {
        if (limits.maxItems !== undefined && value.length > limits.maxItems) {
          diagnostics.push({
            level: 'warn',
            code: 'copy/over-budget',
            slide: frame.slideNumber,
            message: `${value.length} bullets, but the "${role}" role budgets ${limits.maxItems}.`,
            hint: 'cut to the strongest points. One idea per slide beats four half-ideas.',
          });
        }
        if (limits.maxWordsPerItem !== undefined) {
          value.forEach((item, index) => {
            const count = wordCount(String(item));
            if (count > limits.maxWordsPerItem!) {
              diagnostics.push({
                level: 'warn',
                code: 'copy/over-budget',
                slide: frame.slideNumber,
                message: `Bullet ${index + 1} is ${count} words; the "${role}" role budgets ${limits.maxWordsPerItem}.`,
                hint: 'bullets are scanned, not read. Lead with the bold keyword.',
              });
            }
          });
        }
        continue;
      }

      if (typeof value !== 'string' || value.trim() === '') continue;

      if (limits.maxWords !== undefined) {
        const count = wordCount(value);
        if (count > limits.maxWords) {
          diagnostics.push({
            level: 'warn',
            code: 'copy/over-budget',
            slide: frame.slideNumber,
            message: `${slot} is ${count} words; the "${role}" role budgets ${limits.maxWords}.`,
            hint: 'long copy is the number one failure mode of generated carousels — it stops being readable in the feed.',
          });
        }
      }
      if (limits.maxLines !== undefined) {
        const count = value.split(/\r?\n/).filter((l) => l.trim()).length;
        if (count > limits.maxLines) {
          diagnostics.push({
            level: 'warn',
            code: 'copy/over-budget',
            slide: frame.slideNumber,
            message: `${slot} has ${count} lines; the "${role}" role budgets ${limits.maxLines}.`,
          });
        }
      }
    }

    for (const required of frame.role?.requires ?? []) {
      const value = (frame.slide as Record<string, unknown>)[required];
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);
      if (empty) {
        diagnostics.push({
          level: 'warn',
          code: 'copy/missing-slot',
          slide: frame.slideNumber,
          message: `The "${frame.role?.id}" role needs a ${required}, but the slide has none.`,
          ...(frame.role?.purpose ? { hint: `that role exists to ${frame.role.purpose}.` } : {}),
        });
      }
    }
  }

  // --- total text per slide ------------------------------------------------
  for (const frame of frames) {
    const total = slideWordCount([
      frame.slide.eyebrow,
      frame.slide.title,
      frame.slide.body,
      frame.slide.note,
      ...(frame.slide.bullets ?? []),
    ]);
    if (total > 45) {
      diagnostics.push({
        level: 'warn',
        code: 'copy/too-dense',
        slide: frame.slideNumber,
        message: `${total} words on one slide. At the size Instagram shows a carousel, this is a wall of text.`,
        hint: 'split it across two slides, or cut it to one idea.',
      });
    }
  }

  // --- slides that repeat the slide before them ---------------------------
  for (let i = 1; i < frames.length; i += 1) {
    const previous = frames[i - 1]!;
    const current = frames[i]!;
    const a = contentTokens([previous.slide.title, previous.slide.body].filter(Boolean).join(' '));
    const b = contentTokens([current.slide.title, current.slide.body].filter(Boolean).join(' '));
    if (a.size < 3 || b.size < 3) continue;
    const similarity = jaccard(a, b);
    if (similarity >= 0.6) {
      diagnostics.push({
        level: 'warn',
        code: 'copy/no-new-information',
        slide: current.slideNumber,
        message: `Slide ${current.slideNumber} repeats most of slide ${previous.slideNumber} (${Math.round(similarity * 100)}% of the same words).`,
        hint: 'every slide has to earn its swipe. Either add something new or merge the two.',
      });
    }
  }

  // --- narrative shape -----------------------------------------------------
  if (narrative) {
    const range = slideCountRange(narrative);
    if (frames.length < range.min || frames.length > range.max) {
      diagnostics.push({
        level: 'warn',
        code: 'narrative/slide-count',
        message: `The "${narrative.manifest.name}" narrative describes ${range.min === range.max ? `${range.min} slides` : `${range.min}-${range.max} slides`}, but the carousel has ${frames.length}.`,
        hint: 'add or remove slides, or switch to a narrative that fits the length you want.',
      });
    }
    for (const frame of frames) {
      if (frame.slide.role && !frame.role) {
        diagnostics.push({
          level: 'error',
          code: 'narrative/unknown-role',
          slide: frame.slideNumber,
          message: `Unknown role "${frame.slide.role}".`,
          hint: `"${narrative.manifest.name}" defines: ${narrative.manifest.roles.map((r) => r.id).join(', ')}.`,
        });
      }
    }
  }

  return diagnostics;
}
