// Serves apps/web/dist the way Vercel does with this repo's vercel.json:
// existing files first, then every other path rewritten to /index.html (SPA routes).
//   npm run build && node apps/web/scripts/serve-dist.mjs   →  http://localhost:4173
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  const file = normalize(join(root, path));
  let target = join(root, 'index.html');
  if (file.startsWith(root)) {
    try {
      if ((await stat(file)).isFile()) target = file;
    } catch {
      /* not a file → SPA rewrite */
    }
  }
  res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream' });
  res.end(await readFile(target));
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port} (SPA rewrites on)`));
