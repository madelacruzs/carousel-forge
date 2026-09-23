import pc from 'picocolors';

let quiet = false;

export function setQuiet(value: boolean): void {
  quiet = value;
}

export const log = {
  info(message: string): void {
    if (!quiet) console.log(message);
  },
  step(message: string): void {
    if (!quiet) console.log(`${pc.cyan('›')} ${message}`);
  },
  success(message: string): void {
    if (!quiet) console.log(`${pc.green('✓')} ${message}`);
  },
  warn(message: string): void {
    console.warn(`${pc.yellow('!')} ${message}`);
  },
  error(message: string): void {
    console.error(`${pc.red('✗')} ${message}`);
  },
  plain(message: string): void {
    if (!quiet) console.log(message);
  },
};

export { pc };
