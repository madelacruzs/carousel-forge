export type DiagnosticLevel = 'error' | 'warn' | 'info';

export interface Diagnostic {
  level: DiagnosticLevel;
  /** Stable machine-readable id, e.g. `copy/weak-hook`. */
  code: string;
  /** 1-based slide number, when the finding belongs to a slide. */
  slide?: number;
  message: string;
  hint?: string;
}

export interface DoctorReport {
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  infos: number;
}

export function summarizeDiagnostics(diagnostics: Diagnostic[]): DoctorReport {
  return {
    diagnostics,
    errors: diagnostics.filter((d) => d.level === 'error').length,
    warnings: diagnostics.filter((d) => d.level === 'warn').length,
    infos: diagnostics.filter((d) => d.level === 'info').length,
  };
}
