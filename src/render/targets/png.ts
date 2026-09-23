import path from 'node:path';
import { ensureDir, writeBinary } from '../../util/fs.js';
import type { RenderedFrame } from '../renderer.js';
import type { OutputTarget, TargetContext, TargetResult } from './target.js';

export interface PngTargetOptions {
  outDir: string;
  /** File name pattern. `{n}` is the zero-padded slide number. */
  pattern?: string;
}

/** Writes one PNG per frame: `out/slide-01.png`, `out/slide-02.png`, … */
export class PngTarget implements OutputTarget {
  readonly name = 'png';
  private readonly files: string[] = [];
  private width = 2;

  constructor(private readonly options: PngTargetOptions) {}

  async begin(context: TargetContext): Promise<void> {
    this.width = Math.max(2, String(context.frameCount).length);
    await ensureDir(this.options.outDir);
  }

  async write(rendered: RenderedFrame): Promise<void> {
    const pattern = this.options.pattern ?? 'slide-{n}.png';
    const name = pattern.replace(
      '{n}',
      String(rendered.frame.slideNumber).padStart(this.width, '0'),
    );
    const file = path.join(this.options.outDir, name);
    await writeBinary(file, rendered.png);
    this.files.push(file);
  }

  finalize(): TargetResult {
    return { files: [...this.files] };
  }
}
