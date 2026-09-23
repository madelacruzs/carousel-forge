import sharp from 'sharp';

export interface ContactSheetOptions {
  /** PNG buffers in slide order. */
  slides: Buffer[];
  /** Slides per row. Defaults to 5, which reads like an Instagram preview strip. */
  columns?: number;
  /** Width of each thumbnail in the sheet. */
  thumbWidth?: number;
  gap?: number;
  padding?: number;
  background?: string;
}

/**
 * A grid of every slide, the way you scan a carousel before posting it.
 * Deliberately plain: this is a working tool, not a design surface.
 */
export async function renderContactSheet(options: ContactSheetOptions): Promise<Buffer> {
  const { slides } = options;
  if (slides.length === 0) throw new Error('contact sheet needs at least one slide');

  const columns = Math.max(1, Math.min(options.columns ?? 5, slides.length));
  const thumbWidth = options.thumbWidth ?? 320;
  const gap = options.gap ?? 16;
  const padding = options.padding ?? 24;
  const background = options.background ?? '#101010';

  const first = await sharp(slides[0] as Buffer).metadata();
  const aspect = (first.height ?? 1350) / (first.width ?? 1080);
  const thumbHeight = Math.round(thumbWidth * aspect);

  const rows = Math.ceil(slides.length / columns);
  const width = padding * 2 + columns * thumbWidth + (columns - 1) * gap;
  const height = padding * 2 + rows * thumbHeight + (rows - 1) * gap;

  const composites = await Promise.all(
    slides.map(async (png, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const input = await sharp(png)
        .resize(thumbWidth, thumbHeight, { fit: 'fill', kernel: 'lanczos3' })
        .png({ compressionLevel: 9, effort: 7 })
        .toBuffer();
      return {
        input,
        left: padding + column * (thumbWidth + gap),
        top: padding + row * (thumbHeight + gap),
      };
    }),
  );

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background,
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, effort: 7 })
    .toBuffer();
}
