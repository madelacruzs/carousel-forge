import { createHash } from 'node:crypto';

/**
 * Chromium refuses to load a `data:` URL larger than 2 MB, and does it
 * *silently* — the element simply never paints. A cropped 1080x1350
 * photograph with any real detail in it encodes well past that, so photos are
 * served to the page over a fake origin and fulfilled from memory instead.
 *
 * URLs are content-addressed, so the same bytes always produce the same URL
 * and renders stay byte-identical.
 */
const ORIGIN = 'https://asset.carousel-forge.invalid';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export interface Asset {
  url: string;
  mime: string;
  bytes: Buffer;
}

const assets = new Map<string, Asset>();

/** Register bytes and get back the URL the page should reference. */
export function registerAsset(bytes: Buffer, mime: string): string {
  const digest = createHash('sha256').update(bytes).digest('hex');
  const ext = EXT_BY_MIME[mime] ?? 'bin';
  const url = `${ORIGIN}/${digest}.${ext}`;
  if (!assets.has(url)) assets.set(url, { url, mime, bytes });
  return url;
}

export function lookupAsset(url: string): Asset | undefined {
  return assets.get(url);
}

export function isAssetUrl(url: string): boolean {
  return url.startsWith(`${ORIGIN}/`);
}

export function assetOrigin(): string {
  return ORIGIN;
}

export function clearAssets(): void {
  assets.clear();
}
