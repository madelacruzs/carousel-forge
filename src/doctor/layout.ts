import {
  contrastRatio,
  meanLuminance,
  parseCssColor,
  patchLuminances,
  relativeLuminance,
} from '../image/prepare.js';
import type { ProjectContext } from '../pipeline/context.js';
import type { RenderedFrame } from '../render/renderer.js';
import { KNOWN_SLOTS } from '../content/schema.js';
import { thumbnailFontSize } from './hooks.js';
import type { Diagnostic } from './types.js';

/**
 * Slots the audience actually reads, as opposed to chrome like the slide
 * number or the handle. Checks that exist to protect comprehension apply to
 * these; checks that would only nag about decoration do not.
 */
const READING_SLOTS = new Set(['title', 'body', 'bullets', 'cta']);

/**
 * Layout checks run against the *rendered* page rather than the source.
 *
 * Text boxes, colours and line counts come from the live DOM, and the
 * background luminance is sampled from the actual PNG. That keeps every check
 * theme-agnostic: core never needs to know how a theme positions anything.
 */
export async function auditLayout(
  project: ProjectContext,
  rendered: RenderedFrame[],
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const { canvas, safeArea } = project.theme.manifest;

  const safe = {
    left: safeArea.left,
    top: safeArea.top,
    right: canvas.w - safeArea.right,
    bottom: canvas.h - safeArea.bottom,
  };

  for (const item of rendered) {
    const slideNumber = item.frame.slideNumber;

    for (const probe of item.probes) {
      if (probe.width <= 0 || probe.height <= 0) continue;

      // --- safe area ------------------------------------------------------
      const overflow = {
        left: Math.round(safe.left - probe.x),
        top: Math.round(safe.top - probe.y),
        right: Math.round(probe.x + probe.width - safe.right),
        bottom: Math.round(probe.y + probe.height - safe.bottom),
      };
      const worst = Object.entries(overflow)
        .filter(([, value]) => value > 1)
        .sort((a, b) => b[1] - a[1])[0];
      if (worst) {
        diagnostics.push({
          level: 'warn',
          code: 'layout/safe-area',
          slide: slideNumber,
          message: `"${probe.slot}" crosses the safe area by ${worst[1]}px on the ${worst[0]}.`,
          hint: 'Instagram crops and overlays the edges of a post. Shorten the copy or widen the theme safe area.',
        });
      }

      // --- clipping -------------------------------------------------------
      if (probe.clipped) {
        diagnostics.push({
          level: 'error',
          code: 'layout/clipped',
          slide: slideNumber,
          message: `"${probe.slot}" does not fit its box and is being cut off.`,
          hint: 'this text is literally invisible in the export. Cut it down.',
        });
      }

      // --- the font actually being used -------------------------------------
      // A substituted font is invisible unless you know both typefaces, so
      // nothing else in the lint would ever catch it. It is reported as an
      // error rather than a warning because the export is simply wrong: the
      // slide is not in the typeface the theme asked for.
      if (probe.missingGlyphs && probe.missingGlyphs.length > 0) {
        const chars = probe.missingGlyphs.slice(0, 12).join(' ');
        const more =
          probe.missingGlyphs.length > 12 ? ` (+${probe.missingGlyphs.length - 12} more)` : '';
        const family = (probe.fontFamily || '')
          .split(',')[0]
          ?.trim()
          .replace(/^["']|["']$/g, '');
        diagnostics.push({
          level: 'error',
          code: 'font/missing-glyphs',
          slide: slideNumber,
          message: `"${probe.slot}" uses characters ${family ? `${family} ` : ''}does not supply, so a system font was substituted for them: ${chars}${more}`,
          hint: 'the slide will not look like the theme. Delete the font cache and rebuild to refetch, or pick a face that covers this language.',
        });
      }

      // --- readable at thumbnail size --------------------------------------
      // Only the title has to survive a grid preview. Body copy is read after
      // the tap, so holding it to the same bar would be noise, not a finding.
      if (probe.slot === 'title' && probe.text.length > 0) {
        const thumb = thumbnailFontSize(probe.fontSize, canvas.w);
        if (thumb > 0 && thumb < 4.2) {
          diagnostics.push({
            level: 'warn',
            code: 'layout/thumbnail-legibility',
            slide: slideNumber,
            message: `the title renders at ${Math.round(probe.fontSize)}px, about ${thumb.toFixed(1)}px in a grid preview.`,
            hint: 'people decide whether to open a post from the thumbnail. A title this small cannot do that job.',
          });
        }
      }

      // --- readable on the phone at all -------------------------------------
      const minReadable = canvas.w * 0.0185; // ~20px on a 1080 canvas
      if (READING_SLOTS.has(probe.slot) && probe.text.length > 0 && probe.fontSize < minReadable) {
        diagnostics.push({
          level: 'warn',
          code: 'layout/small-text',
          slide: slideNumber,
          message: `"${probe.slot}" renders at ${Math.round(probe.fontSize)}px, under the ~${Math.round(minReadable)}px this canvas needs.`,
          hint: 'a carousel is read at arm\u2019s length on a phone. Cut the copy instead of shrinking the type.',
        });
      }

      // --- contrast against whatever is actually behind the text ----------
      const rgb = parseCssColor(probe.color);
      if (rgb && probe.text.length > 0) {
        const textLuminance = relativeLuminance(rgb[0], rgb[1], rgb[2]);
        const rect = { x: probe.x, y: probe.y, width: probe.width, height: probe.height };
        // Measure the backdrop, never the finished slide: sampling the latter
        // includes the glyphs themselves, so the score tracks ink coverage
        // rather than what the type has to stay legible against.
        const behind = item.backdrop ?? item.png;
        const meanRatio = contrastRatio(textLuminance, await meanLuminance(behind, rect));

        // Judge how much of the line fails, not the average and not the single
        // worst cell. A mean hides a blown-out window behind half a headline;
        // the worst cell fires on one stray highlight in a gap between glyphs.
        // Counting the share of the box that falls under the bar expresses the
        // thing that actually matters — whether a readable run of the line has
        // gone illegible — and separates the two cleanly.
        const patches = await patchLuminances(behind, rect);
        const ratios = patches.map((patch) => contrastRatio(textLuminance, patch));

        // Copy the audience has to read is held to WCAG. Chrome — the slide
        // number, the handle, labels — is allowed to recede, so it only has to
        // clear the large-text bar.
        const threshold = READING_SLOTS.has(probe.slot) && probe.fontSize < 24 ? 4.5 : 3;

        const failing = ratios.filter((r) => r < threshold);
        const share = ratios.length > 0 ? failing.length / ratios.length : 0;
        // An eighth of a line is roughly a short word at this type size: small
        // enough to catch a blown-out patch behind part of a headline, large
        // enough that noise in a busy photograph does not trip it.
        const FAIL_SHARE = 1 / 8;
        if (share >= FAIL_SHARE && failing.length > 0) {
          const worst = Math.min(...failing);
          const ratio = failing.reduce((a, b) => a + b, 0) / failing.length;
          const local = meanRatio >= threshold;
          diagnostics.push({
            level: 'warn',
            code: 'layout/low-contrast',
            slide: slideNumber,
            message: local
              ? `"${probe.slot}" drops to ${worst.toFixed(1)}:1 behind ${Math.round(share * 100)}% of the line (want ${threshold}:1). Averaged across the whole line it looks fine at ${meanRatio.toFixed(1)}:1, which is why this is easy to miss.`
              : `"${probe.slot}" sits at ${ratio.toFixed(1)}:1 against the photo behind it, dropping to ${worst.toFixed(1)}:1 (want ${threshold}:1).`,
            hint: 'raise overlay: on this slide, move the focal point to a darker part of the photo, or pick a different image.',
          });
        }
      }
    }

    // --- slots colliding with each other ------------------------------------
    for (let a = 0; a < item.probes.length; a += 1) {
      for (let b = a + 1; b < item.probes.length; b += 1) {
        const one = item.probes[a];
        const two = item.probes[b];
        if (!one || !two) continue;
        if (one.text.length === 0 || two.text.length === 0) continue;
        if (one.width <= 0 || one.height <= 0 || two.width <= 0 || two.height <= 0) continue;

        const overlapW = Math.min(one.x + one.width, two.x + two.width) - Math.max(one.x, two.x);
        const overlapH = Math.min(one.y + one.height, two.y + two.height) - Math.max(one.y, two.y);
        if (overlapW <= 2 || overlapH <= 2) continue;

        // A slot nested inside another one is the theme's business, not a bug.
        const area = overlapW * overlapH;
        const smallest = Math.min(one.width * one.height, two.width * two.height);
        if (area / smallest > 0.9) continue;
        if (area / smallest < 0.06) continue;

        diagnostics.push({
          level: 'error',
          code: 'layout/overlap',
          slide: slideNumber,
          message: `"${one.slot}" and "${two.slot}" overlap by ${Math.round(overlapW)}x${Math.round(overlapH)}px.`,
          hint: 'one of them has outgrown its space. Cut the longer of the two — the theme is not going to reflow around it.',
        });
      }
    }

    // --- source resolution -------------------------------------------------
    for (const [label, image] of Object.entries(item.frame.images)) {
      if (!image) continue;
      if (image.scale < 1) {
        diagnostics.push({
          level: 'warn',
          code: 'image/low-resolution',
          slide: slideNumber,
          message: `${label === 'primary' ? 'The photo' : 'The second photo'} is ${image.source.w}x${image.source.h}, smaller than the ${image.target.w}x${image.target.h} it has to fill.`,
          hint: 'it will be upscaled and look soft. Use a source at least as large as the canvas.',
        });
      }
    }
  }

  // --- slots the theme does not render ------------------------------------
  const declared = new Set(project.theme.manifest.slots);
  if (declared.size > 0) {
    for (const frame of project.frames) {
      for (const slot of KNOWN_SLOTS) {
        const value = (frame.slide as Record<string, unknown>)[slot];
        const filled =
          (typeof value === 'string' && value.trim() !== '') ||
          (Array.isArray(value) && value.length > 0);
        if (filled && !declared.has(slot)) {
          diagnostics.push({
            level: 'warn',
            code: 'theme/unknown-slot',
            slide: frame.slideNumber,
            message: `Slide sets "${slot}", but the theme "${project.theme.manifest.name}" does not declare it.`,
            hint: `the theme renders: ${[...declared].join(', ')}. This copy will not appear in the export.`,
          });
        }
      }
    }
  }

  // --- layouts the theme does not have ------------------------------------
  for (const frame of project.frames) {
    const requested = frame.slide.layout ?? frame.role?.layout;
    if (requested && !project.theme.manifest.layouts.includes(requested)) {
      diagnostics.push({
        level: frame.slide.layout ? 'warn' : 'info',
        code: 'theme/unknown-layout',
        slide: frame.slideNumber,
        message: `Layout "${requested}" is not offered by "${project.theme.manifest.name}"; using "${frame.layout}".`,
        hint: `available layouts: ${project.theme.manifest.layouts.join(', ')}.`,
      });
    }
  }

  // --- carousel length -----------------------------------------------------
  if (project.frames.length > 20) {
    diagnostics.push({
      level: 'error',
      code: 'content/too-many-slides',
      message: `${project.frames.length} slides. Instagram accepts at most 20.`,
    });
  } else if (project.frames.length > 10) {
    diagnostics.push({
      level: 'info',
      code: 'content/long-carousel',
      message: `${project.frames.length} slides. Completion rate drops fast past about 10.`,
      hint: 'consider splitting this into two posts.',
    });
  }

  return diagnostics;
}
