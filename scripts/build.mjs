// Builds the deployable site into ./public from the original dashboard in ./source.
//
//   public/index.html            Spectator view (read-only, photos as separate cached files)
//   public/organiser/index.html  Organiser console = original file + live broadcast add-on
//   public/assets/img/*          Photos/crests/logo extracted for the spectator view
//   public/vendor/supabase.js    Supabase client (served locally, no third-party CDN)
//
// The draft engine itself is NOT modified.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'source/KFL_South_Draft_FINAL_187_Players.html');
const OUT = resolve(ROOT, 'public');
loadEnv(ROOT);

const fail = (msg) => { console.error('\n✖ BUILD FAILED: ' + msg + '\n'); process.exit(1); };
const env = (k) => (process.env[k] || '').trim();

// ---------- config ----------
const supabaseUrl = env('SUPABASE_URL').replace(/\/+$/, '');
const supabaseKey = env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY');
const eventId = env('KFL_EVENT_ID') || 'kfl-south';
const publicUrl = env('KFL_PUBLIC_URL') || (env('VERCEL_PROJECT_PRODUCTION_URL') ? 'https://' + env('VERCEL_PROJECT_PRODUCTION_URL') : '');

if (supabaseUrl && !/^https:\/\/[^/]+$/.test(supabaseUrl)) fail('SUPABASE_URL should look like https://abcd1234.supabase.co (got "' + supabaseUrl + '")');
if (supabaseKey && /service_role|sb_secret_/.test(supabaseKey + decodeRole(supabaseKey))) fail('SUPABASE_ANON_KEY contains a SECRET/service_role key. Use the anon / publishable key here — the secret key would be visible to every spectator.');

function decodeRole(k) {
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role || ''; } catch { return ''; }
}

// ---------- source ----------
if (!existsSync(SOURCE)) fail('Missing ' + SOURCE);
const original = readFileSync(SOURCE, 'utf8');
for (const marker of ['function openAudience(', 'function updateAudience(', 'function validateLoaded(', 'let state=newState(', 'const KFL_PPTX_PHOTOS=', 'let audienceWindow=null']) {
  if (!original.includes(marker)) fail('The source dashboard no longer contains "' + marker + '". The live add-on was written for the final 187-player edition.');
}

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const guardScript = (code) => { if (/<\/script/i.test(code)) fail('Script contains </script>'); return code; };
const configTag = (extra) => `<script>window.KFL_LIVE_CONFIG=${JSON.stringify({ eventId, ...extra }).replace(/</g, '\\u003c')};</script>`;

function injectBeforeBodyEnd(html, snippet) {
  const i = html.lastIndexOf('</body>');
  if (i < 0 || i < html.lastIndexOf('</script>')) fail('Could not find the closing </body> tag');
  return html.slice(0, i) + snippet + '\n' + html.slice(i);
}
function injectHeadEnd(html, snippet) {
  const i = html.indexOf('</head>');
  if (i < 0) fail('Could not find </head>');
  return html.slice(0, i) + snippet + '\n' + html.slice(i);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(resolve(OUT, 'organiser'), { recursive: true });
mkdirSync(resolve(OUT, 'assets/img'), { recursive: true });
mkdirSync(resolve(OUT, 'vendor'), { recursive: true });

// ---------- organiser ----------
// Everything inline so "Save updated dashboard" copies keep working offline and keep broadcasting.
let organiser = injectHeadEnd(original, '<meta name="robots" content="noindex, nofollow">');
organiser = injectBeforeBodyEnd(organiser,
  configTag({ endpoint: publicUrl }) + '\n<script>\n' + guardScript(read('live/publisher.js')) + '\n</script>');
writeFileSync(resolve(OUT, 'organiser/index.html'), organiser);

// ---------- spectator ----------
const assets = new Map();
let spectator = original.replace(/data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=]+)/g, (_, type, b64) => {
  const buf = Buffer.from(b64, 'base64');
  const ext = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif', 'svg+xml': 'svg' }[type];
  const name = createHash('sha1').update(buf).digest('hex').slice(0, 16) + '.' + ext;
  if (!assets.has(name)) { assets.set(name, buf.length); writeFileSync(resolve(OUT, 'assets/img', name), buf); }
  return '/assets/img/' + name;
});
spectator = spectator.replace(/<title>[\s\S]*?<\/title>/, '<title>KFL South Draft · Live</title>');
spectator = spectator.replace('<meta name="color-scheme" content="dark">',
  '<meta name="color-scheme" content="dark"><link rel="icon" href="/favicon.png"><meta name="theme-color" content="#060a16"><meta name="robots" content="noindex, nofollow"><meta name="description" content="Live view of the Khuddam Football League South player draft.">');
spectator = injectHeadEnd(spectator, '<script>\n' + guardScript(read('live/spectator-boot.js')) + '\n</script>');
spectator = injectBeforeBodyEnd(spectator,
  configTag({ supabaseUrl, supabaseKey }) +
  '\n<script src="/vendor/supabase.js"></script>' +
  '\n<script>\n' + guardScript(read('live/spectator.js')) + '\n</script>');
writeFileSync(resolve(OUT, 'index.html'), spectator);

// ---------- vendor ----------
const umdCandidates = [
  'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'node_modules/@supabase/supabase-js/dist/umd/supabase.min.js',
];
const umd = umdCandidates.map((p) => resolve(ROOT, p)).find(existsSync);
if (umd) copyFileSync(umd, resolve(OUT, 'vendor/supabase.js'));
else writeFileSync(resolve(OUT, 'vendor/supabase.js'), '/* supabase-js not installed: spectators use the backup feed */');

writeFileSync(resolve(OUT, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
if (existsSync(resolve(ROOT, 'source/KFL_Official_Logo.png'))) copyFileSync(resolve(ROOT, 'source/KFL_Official_Logo.png'), resolve(OUT, 'favicon.png'));

// ---------- report ----------
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
const total = [...assets.values()].reduce((a, b) => a + b, 0);
console.log('✔ Built ./public');
console.log('  /             spectator   ' + kb(Buffer.byteLength(spectator)) + ' + ' + assets.size + ' images (' + kb(total) + ')');
console.log('  /organiser    organiser   ' + kb(Buffer.byteLength(organiser)));
console.log('  supabase-js   ' + (umd ? 'bundled' : 'MISSING — run npm install (spectators will use the backup feed)'));
console.log('  Realtime      ' + (supabaseUrl && supabaseKey ? 'on (' + supabaseUrl + ')' : 'OFF — SUPABASE_URL / SUPABASE_ANON_KEY not set; spectators poll /api/state'));
console.log('  Event id      ' + eventId);
if (publicUrl) console.log('  Public URL    ' + publicUrl + ' (used by downloaded organiser copies)');
