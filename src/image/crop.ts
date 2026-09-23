/** Pure geometry for focal-point cropping. No I/O, so it is cheap to test. */

export interface Size {
  w: number;
  h: number;
}

export interface CropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const CENTER: readonly [number, number] = [0.5, 0.5];

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Largest rectangle with the target aspect ratio that fits inside `source`,
 * positioned so that `focal` sits as close to its centre as the source allows.
 *
 * This is the `object-fit: cover` + `object-position: <focal>` behaviour, done
 * ahead of time so the browser always receives an exactly sized image and the
 * output does not depend on the browser's own resampling.
 */
export function coverCrop(
  source: Size,
  target: Size,
  focal: readonly [number, number] = CENTER,
): CropRect {
  if (source.w <= 0 || source.h <= 0) {
    throw new Error(`invalid source size ${source.w}x${source.h}`);
  }
  if (target.w <= 0 || target.h <= 0) {
    throw new Error(`invalid target size ${target.w}x${target.h}`);
  }

  const targetAspect = target.w / target.h;
  const sourceAspect = source.w / source.h;

  let width: number;
  let height: number;
  if (sourceAspect > targetAspect) {
    // Source is wider than the target: full height, trim the sides.
    height = source.h;
    width = source.h * targetAspect;
  } else {
    // Source is taller than the target: full width, trim top and bottom.
    width = source.w;
    height = source.w / targetAspect;
  }

  width = Math.min(source.w, Math.max(1, Math.round(width)));
  height = Math.min(source.h, Math.max(1, Math.round(height)));

  const fx = clamp(focal[0], 0, 1);
  const fy = clamp(focal[1], 0, 1);

  const left = Math.round(clamp(fx * source.w - width / 2, 0, source.w - width));
  const top = Math.round(clamp(fy * source.h - height / 2, 0, source.h - height));

  return { left, top, width, height };
}

/**
 * Scale factor that would be applied when fitting `source` into `target` with
 * cover semantics. Below 1 means the source is being upscaled, i.e. the photo
 * is smaller than the canvas and will look soft. `doctor` reports on this.
 */
export function coverScale(source: Size, target: Size): number {
  return Math.min(source.w / target.w, source.h / target.h);
}

/** `true` when the source has enough pixels to fill the target without upscaling. */
export function hasEnoughResolution(source: Size, target: Size): boolean {
  return coverScale(source, target) >= 1;
}
