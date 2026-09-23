import { contrastRatio, meanLuminance, parseCssColor, relativeLuminance } from '../image/prepare.js';
import type { ProjectContext } from '../pipeline/context.js';
import type { RenderedFrame } from '../render/renderer.js';
import { KNOWN_SLOTS } from '../content/schema.js';
import { thumbnailFontSize } from './hooks.js';
import type { Diagnostic } from './types.js';

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

      // --- readable at thumbnail size --------------------------------------
      const thumb = thumbnailFontSize(probe.fontSize, canvas.w);
      if (probe.readable && probe.text.length > 0 && thumb > 0 && thumb < 4.2) {
        diagnostics.push({
          level: 'warn',
          code: 'layout/thumbnail-legibility',
          slide: slideNumber,
          message: `"${probe.slot}" renders at ${Math.round(probe.fontSize)}px, about ${thumb.toFixed(1)}px in a grid preview.`,
          hint: 'people decide whether to open a post from the thumbnail. Anything smaller than this is decoration, not communication.',
        });
      }

      // --- contrast against whatever is actually behind the text ----------
      const rgb = parseCssColor(probe.color);
      if (rgb && probe.text.length > 0) {
        const textLuminance = relativeLuminance(rgb[0], rgb[1], rgb[2]);
        const backgroundLuminance = await meanLuminance(item.png, {
          x: probe.x,
          y: probe.y,
          width: probe.width,
          height: probe.height,
        });
        const ratio = contrastRatio(textLuminance, backgroundLuminance);
        // WCAG large-text threshold; carousel type is nearly always large.
        const isLarge = probe.fontSize >= 24;
        const threshold = isLarge ? 3 : 4.5;
        if (ratio < threshold) {
          diagnostics.push({
            level: 'warn',
            code: 'layout/low-contrast',
            slide: slideNumber,
            message: `"${probe.slot}" sits at ${ratio.toFixed(1)}:1 against the photo behind it (want ${threshold}:1).`,
            hint: 'raise overlay: on this slide, move the focal point to a darker part of the photo, or pick a different image.',
          });
        }
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
