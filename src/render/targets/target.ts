import type { Theme } from '../../theme/load.js';
import type { RenderedFrame } from '../renderer.js';

/**
 * Where rendered frames go.
 *
 * The render pipeline only ever hands a target a `RenderedFrame`, so adding a
 * video target later is a matter of writing a new implementation of this
 * interface — no change to frame building, theming or rendering.
 */
export interface OutputTarget {
  /** Short identifier used in logs, e.g. `png`. */
  readonly name: string;
  /** Called once before the first frame. */
  begin?(context: TargetContext): Promise<void> | void;
  /** Called once per rendered frame, in order. */
  write(frame: RenderedFrame): Promise<void> | void;
  /** Called once after the last frame. Returns the artefacts produced. */
  finalize?(): Promise<TargetResult> | TargetResult;
}

export interface TargetContext {
  theme: Theme;
  /** Total frames that will be written. */
  frameCount: number;
  /** Absolute output directory. */
  outDir: string;
}

export interface TargetResult {
  /** Absolute paths of files written. */
  files: string[];
}
