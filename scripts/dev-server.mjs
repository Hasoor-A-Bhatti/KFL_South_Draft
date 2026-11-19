// Local test server that behaves like Vercel: serves ./public with clean URLs
// and runs the /api functions. Reads .env.local.
//   npm run dev  →  http://localhost:3000  (spectator)  and  /organiser
// Without Supabase keys it uses an in-memory store so you can still rehearse.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from './env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = resolve(ROOT, 'public');
loadEnv(ROOT);

const memory = !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;
if (memory) process.env.KFL_ALLOW_MEMORY_STORE = '1';
if (!process.env.ORGANISER_PUBLISH_KEY) { process.env.ORGANISER_PUBLISH_KEY = 'test'; }

const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css' };

const handlers = {};
async function api(name) {
  if (!handlers[name]) handlers[name] = (await import(pathToFileURL(resolve(ROOT, 'api', name + '.js')).href)).default;
  return handlers[name];
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const m = url.pathname.match(/^\/api\/([a-z-]+)$/);
    if (m) return await (await api(m[1]))(req, res);

    let p = decodeURIComponent(url.pathname);
    const candidates = p.endsWith('/') ? [p + 'index.html'] : [p, p + '.html', p + '/index.html'];
    for (const c of candidates) {
      const file = normalize(resolve(PUBLIC, '.' + c));
      if (!file.startsWith(PUBLIC + sep) && file !== PUBLIC) break;
      const s = await stat(file).catch(() => null);
      if (s && s.isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        return res.end(await readFile(file));
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
}).listen(PORT, () => {
  console.log(`\nKFL local server running`);
  console.log(`  Spectator:  http://localhost:${PORT}/`);
  console.log(`  Organiser:  http://localhost:${PORT}/organiser`);
  console.log(`  Storage:    ${memory ? 'IN-MEMORY test mode (no Supabase keys in .env.local)' : 'Supabase ' + process.env.SUPABASE_URL}`);
  console.log(`  Organiser key: ${process.env.ORGANISER_PUBLISH_KEY === 'test' && !memory ? '(unset!)' : process.env.ORGANISER_PUBLISH_KEY === 'test' ? '"test"' : 'from .env.local'}\n`);
});
