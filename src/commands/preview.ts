import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { build } from '../pipeline/build.js';
import { displayPath } from '../util/fs.js';
import { log, pc } from '../util/log.js';

export interface PreviewCommandOptions {
  configFile: string;
  outDir: string;
  port: number;
  open?: boolean;
  offline?: boolean;
  /** Build before serving. */
  rebuild?: boolean;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

function indexHtml(slides: string[], hasSheet: boolean, hasCaption: boolean): string {
  const thumbs = slides
    .map(
      (name, index) =>
        `<figure><img src="./${name}" alt="slide ${index + 1}" loading="lazy"><figcaption>${index + 1}</figcaption></figure>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>carousel preview</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 32px; background: #0d0d0d; color: #e8e8e8;
         font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  h1 { font-size: 15px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #8a8a8a; margin: 0 0 20px; }
  h2 { font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: #8a8a8a; margin: 40px 0 16px; }
  .strip { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 12px; scroll-snap-type: x mandatory; }
  .strip figure { margin: 0; flex: 0 0 auto; scroll-snap-align: center; }
  .strip img { width: 260px; height: auto; border-radius: 6px; display: block; }
  figcaption { color: #6c6c6c; font-size: 12px; margin-top: 6px; text-align: center; }
  .sheet img { max-width: 100%; border-radius: 8px; }
  a { color: #E8C47A; }
</style>
</head>
<body>
  <h1>carousel preview</h1>
  <div class="strip">${thumbs}</div>
  ${hasSheet ? '<h2>contact sheet</h2><div class="sheet"><img src="./contact-sheet.png" alt="contact sheet"></div>' : ''}
  ${hasCaption ? '<h2>caption</h2><p><a href="./caption.md">caption.md</a></p>' : ''}
</body>
</html>`;
}

export async function previewCommand(options: PreviewCommandOptions): Promise<void> {
  const outDir = path.resolve(options.outDir);

  if (options.rebuild !== false) {
    const result = await build({
      configFile: options.configFile,
      outDir,
      ...(options.offline !== undefined ? { offline: options.offline } : {}),
    });
    log.success(`rendered ${result.rendered.length} slides`);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '');

    if (name === '' || name === 'index.html') {
      const entries = await fs.readdir(outDir).catch(() => [] as string[]);
      const slides = entries.filter((f) => /^slide-\d+\.png$/.test(f)).sort();
      const body = indexHtml(
        slides,
        entries.includes('contact-sheet.png'),
        entries.includes('caption.md'),
      );
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(body);
      return;
    }

    // Serve only files directly inside the output directory.
    const file = path.join(outDir, name);
    if (path.dirname(file) !== outDir) {
      response.writeHead(403);
      response.end('forbidden');
      return;
    }
    try {
      const bytes = await fs.readFile(file);
      response.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end('not found');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  log.info('');
  log.info(`preview  ${pc.cyan(`http://127.0.0.1:${port}`)}`);
  log.info(pc.dim(`serving ${displayPath(outDir)} — ctrl-c to stop`));

  await new Promise<void>((resolve) => {
    const stop = () => server.close(() => resolve());
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}
