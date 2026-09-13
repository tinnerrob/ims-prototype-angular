#!/usr/bin/env node
/**
 * Serve the production build with SPA fallback, for the smoke test.
 *
 * No dependency: `node:http` + `node:fs`, so `npm run e2e` needs nothing installed
 * beyond Playwright itself. Deep links (`/admin/verticals`, `/purchasing`) have no file
 * on disk, so anything that is not an existing asset falls back to `index.html` — which
 * is what a real static host does for a client-routed app.
 *
 * Usage: node scripts/serve-dist.mjs [port]   (default 4173)
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = join(process.cwd(), 'dist', 'ims-web', 'browser');
const PORT = Number(process.argv[2] ?? 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function serve(port = PORT) {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const safe = normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
    let file = join(ROOT, safe);
    if (safe.endsWith('/') || (existsSync(file) && statSync(file).isDirectory())) file = join(file, 'index.html');
    if (!existsSync(file)) file = join(ROOT, 'index.html');
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === 'file://' + process.argv[1]) {
  serve().then(() => console.log('serving dist/ims-web/browser on http://localhost:' + PORT));
}
