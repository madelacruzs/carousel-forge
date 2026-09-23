/**
 * carousel-forge — programmatic API.
 *
 * Two orthogonal concepts run through everything here:
 *   Theme     — how a carousel looks   (themes/<name>/)
 *   Narrative — what it says, in order (narratives/<name>.yaml)
 * They never reference each other. Any theme composes with any narrative.
 */

export { ForgeError, formatForgeError, isForgeError } from './errors.js';

export * from './content/schema.js';
export { loadCarousel, parseCarousel, formatZodError } from './content/load.js';
export type { LoadedCarousel } from './content/load.js';

export * from './theme/schema.js';
export { loadTheme, listThemes, resolveThemeDir, resolveLayout } from './theme/load.js';
export type { Theme, ThemeListing } from './theme/load.js';
export { mergeTokens, tokensToCss, tokenToCssVar } from './theme/tokens.js';
export type { Tokens, TokenValue } from './theme/tokens.js';

export * from './narrative/schema.js';
export { loadNarrative, listNarratives, loadHooks } from './narrative/load.js';
export type { Narrative, NarrativeListing } from './narrative/load.js';
export {
  assignRoles,
  budgetFor,
  expandRoles,
  slideCountRange,
  repeatRange,
} from './narrative/resolve.js';
export type { RoleAssignment } from './narrative/resolve.js';

export { coverCrop, coverScale, hasEnoughResolution } from './image/crop.js';
export type { CropRect, Size } from './image/crop.js';
export {
  prepareImage,
  assetUrl,
  inlineAsset,
  clearImageCache,
  contrastRatio,
  relativeLuminance,
  luminanceBands,
  LUMA_ROWS,
  LUMA_COLS,
} from './image/prepare.js';
export type { PreparedImage, LuminanceBands } from './image/prepare.js';

export { buildFrames, padIndex, splitTitle } from './render/frame.js';
export type { Frame, TemplateContext } from './render/frame.js';
export { renderFrameHtml, compileTemplate, clearTemplateCache } from './render/html.js';
export { Renderer } from './render/renderer.js';
export type { RenderedFrame, SlotProbe } from './render/renderer.js';
export { renderContactSheet } from './render/contactSheet.js';
export type { OutputTarget, TargetContext, TargetResult } from './render/targets/target.js';
export { PngTarget } from './render/targets/png.js';
export {
  registerAsset,
  lookupAsset,
  isAssetUrl,
  assetOrigin,
  clearAssets,
} from './render/assets.js';
export type { Asset } from './render/assets.js';

export { ensureGoogleFonts, fontFaceCss, fontCacheDir, themeFontFaces } from './fonts/google.js';

export { build, summarize } from './pipeline/build.js';
export type { BuildOptions, BuildResult } from './pipeline/build.js';
export { loadProject, defaultConfigPath } from './pipeline/context.js';
export type { ProjectContext } from './pipeline/context.js';
export { renderCaptionScaffold } from './pipeline/caption.js';

export {
  doctor,
  auditCopy,
  auditLayout,
  detectHook,
  looksLikeCta,
  patternToRegex,
} from './doctor/index.js';
export type { Diagnostic, DiagnosticLevel, DoctorReport } from './doctor/types.js';
