import type { Carousel } from '../content/schema.js';
import type { Frame } from '../render/frame.js';

const PLACEHOLDER = '<!-- TODO -->';

function bullet(items: string[] | undefined, fallback: string): string {
  if (!items || items.length === 0) return `- ${fallback}`;
  return items.map((item) => `- ${item.startsWith('#') ? item : `#${item}`}`).join('\n');
}

/**
 * A deterministic scaffold for the post caption.
 *
 * This intentionally writes no copy of its own. The CLI has no language model,
 * and template-generated captions read like spam. Everything here is derived
 * mechanically from `carousel.yaml`; an agent following
 * `skills/instagram-carousel/SKILL.md` fills in the blanks.
 */
export function renderCaptionScaffold(carousel: Carousel, frames: Frame[]): string {
  const caption = carousel.caption;
  const handle = carousel.brand?.handle;

  const outline = frames.map((frame) => {
    const role = frame.role?.id ?? frame.layout;
    const title = frame.slide.title?.replace(/\s*\n\s*/g, ' ').trim();
    const body = frame.slide.body?.replace(/\s*\n\s*/g, ' ').trim();
    const summary = title || body || '(no copy)';
    return `${frame.slideNumber}. **${role}** — ${summary}`;
  });

  const ctas = frames
    .map((frame) => frame.slide.cta?.replace(/\s*\n\s*/g, ' ').trim())
    .filter((cta): cta is string => Boolean(cta));

  const lines: string[] = [
    '<!--',
    '  Scaffold written by `carousel-forge build`.',
    '  The structure is mechanical; the words are not written for you on purpose.',
    '  Fill in every TODO, then paste the caption into Instagram.',
    '-->',
    '',
    '# Caption',
    '',
    caption?.text?.trim() ||
      `${PLACEHOLDER} write the caption: one hook line, a short payoff, then the CTA.`,
    '',
    '## Slide outline',
    '',
    ...(outline.length > 0 ? outline : ['(no slides)']),
    '',
    '## Call to action',
    '',
    ctas.length > 0
      ? ctas.map((cta) => `- ${cta}`).join('\n')
      : `- ${PLACEHOLDER} no slide declares a \`cta:\` — add one to the final slide.`,
    '',
    '## Hashtags',
    '',
    '### Broad — reach',
    bullet(caption?.hashtags?.broad, `${PLACEHOLDER} 3-5 large tags for the general topic`),
    '',
    '### Niche — relevance',
    bullet(caption?.hashtags?.niche, `${PLACEHOLDER} 8-12 specific tags for this exact audience`),
    '',
    '### Branded',
    bullet(
      caption?.hashtags?.branded,
      handle ? `#${handle.replace(/^@/, '')}` : `${PLACEHOLDER} your own tag`,
    ),
    '',
    '## First comment',
    '',
    caption?.firstComment?.trim() ||
      `${PLACEHOLDER} the first comment is prime real estate — put the link, the long-form context, or a question that invites replies.`,
    '',
  ];

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
