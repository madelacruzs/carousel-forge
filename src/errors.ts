/**
 * A user-facing error. The CLI prints these without a stack trace, because they
 * describe a problem with the user's project rather than a bug in the tool.
 */
export class ForgeError extends Error {
  readonly hint?: string;
  readonly where?: string;

  constructor(message: string, options: { hint?: string; where?: string; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ForgeError';
    this.hint = options.hint;
    this.where = options.where;
  }
}

export function isForgeError(error: unknown): error is ForgeError {
  return error instanceof ForgeError;
}

export function formatForgeError(error: ForgeError): string {
  const lines: string[] = [];
  if (error.where) lines.push(error.where);
  lines.push(error.message);
  if (error.hint) lines.push('', `hint: ${error.hint}`);
  return lines.join('\n');
}
