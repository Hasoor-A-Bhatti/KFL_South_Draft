// npm run check — verifies .env.local and the Supabase project before the event.
// Read-only for the draft: it never changes what spectators see.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv(ROOT);
const env = (k) => (process.env[k] || '').trim();
const URL_ = env('SUPABASE_URL').replace(/\/+$/, '');
const ANON = env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY');
const SECRET = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');
const EVENT = env('KFL_EVENT_ID') || 'kfl-south';
let failed = 0;
const ok = (m) => console.log('  ✔ ' + m);
const bad = (m, hint) => { failed++; console.log('  ✖ ' + m + (hint ? '\n      → ' + hint : '')); };
const hdr = (key, extra = {}) => ({ apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('sb_') ? {} : { Authorization: 'Bearer ' + key }), ...extra });

console.log('\nKFL live setup check\n');
console.log('Environment (.env.local)');
if (/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(URL_)) ok('SUPABASE_URL ' + URL_);
else bad('SUPABASE_URL missing or unusual: "' + URL_ + '"', 'Supabase → Project Settings → API → Project URL');
if (ANON) ok('SUPABASE_ANON_KEY set'); else bad('SUPABASE_ANON_KEY missing', 'Supabase → Project Settings → API Keys → anon / publishable');
if (SECRET) ok('SUPABASE_SERVICE_ROLE_KEY set'); else bad('SUPABASE_SERVICE_ROLE_KEY missing', 'Supabase → Project Settings → API Keys → service_role / secret');
if (ANON && SECRET && ANON === SECRET) bad('Anon and service keys are identical', 'They must be two different keys');
const pk = env('ORGANISER_PUBLISH_KEY');
if (pk.length >= 10) ok('ORGANISER_PUBLISH_KEY set (' + pk.length + ' characters)');
else bad('ORGANISER_PUBLISH_KEY ' + (pk ? 'is short (' + pk.length + ' chars)' : 'missing'), 'Use 10+ characters, e.g. three random words');
if (!URL_ || !ANON || !SECRET) { console.log('\nFix the above, then run npm run check again.\n'); process.exit(1); }

console.log('\nDatabase');
try {
  const r = await fetch(`${URL_}/rest/v1/kfl_live?id=eq.${EVENT}&select=id,seq,updated_at`, { headers: hdr(ANON) });
  const t = await r.text();
  if (r.ok) {
    const rows = JSON.parse(t);
    rows.length ? ok('Public can read kfl_live (row "' + EVENT + '", seq ' + rows[0].seq + ')') : bad('kfl_live has no "' + EVENT + '" row', 'Run supabase/setup.sql again (it seeds the row)');
  } else bad('Public read of kfl_live failed: HTTP ' + r.status + ' ' + t.slice(0, 160), /relation|exist|schema/i.test(t) ? 'Run supabase/setup.sql in the SQL Editor' : 'Check SUPABASE_ANON_KEY');
} catch (e) { bad('Could not reach Supabase: ' + e.message, 'Is the project paused? Open it in the Supabase dashboard to wake it.'); }

try {
  const r = await fetch(`${URL_}/rest/v1/kfl_roster?id=eq.${EVENT}&select=id`, { headers: hdr(ANON) });
  r.ok ? ok('Public can read kfl_roster') : bad('Public read of kfl_roster failed: HTTP ' + r.status, 'Run supabase/setup.sql');
} catch (e) { bad('kfl_roster: ' + e.message); }

try { // no-op write: matches no rows, proves the secret key can write
  const r = await fetch(`${URL_}/rest/v1/kfl_live?id=eq.${EVENT}&seq=lt.0&select=seq`, { method: 'PATCH', headers: hdr(SECRET, { Prefer: 'return=representation' }), body: JSON.stringify({ seq: 0 }) });
  r.ok ? ok('Service key can write') : bad('Service key write test failed: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160), 'Check SUPABASE_SERVICE_ROLE_KEY (it must be the secret / service_role key)');
} catch (e) { bad('Service key: ' + e.message); }

try { // public must NOT be able to write
  const r = await fetch(`${URL_}/rest/v1/kfl_live?id=eq.${EVENT}&select=seq`, { method: 'PATCH', headers: hdr(ANON, { Prefer: 'return=representation' }), body: JSON.stringify({ roster_hash: 'x' }) });
  const t = await r.text();
  if (!r.ok || t.trim() === '[]') ok('Public key cannot write (RLS working)');
  else bad('PUBLIC KEY CAN WRITE to kfl_live!', 'Run supabase/setup.sql — row level security must be enabled');
} catch (e) { bad('RLS test: ' + e.message); }

console.log('\nRealtime');
try {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await new Promise((resolveP) => {
    let subscribed = false;
    const timer = setTimeout(() => resolveP(subscribed ? 'no-event' : 'no-subscribe'), 12000);
    client.channel('kfl-check-' + Date.now())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'kfl_live', filter: 'id=eq.' + EVENT }, () => { clearTimeout(timer); resolveP('ok'); })
      .subscribe(async (st) => {
        if (st === 'SUBSCRIBED' && !subscribed) {
          subscribed = true;
          ok('Subscribed to Realtime');
          // Touch updated_at only (seq unchanged → spectators ignore it). Supabase needs a moment
          // after SUBSCRIBED before change events flow, so wait, then retry a few times.
          for (const wait of [1500, 2500, 3000]) {
            await new Promise((r) => setTimeout(r, wait));
            await fetch(`${URL_}/rest/v1/kfl_live?id=eq.${EVENT}`, { method: 'PATCH', headers: hdr(SECRET, { Prefer: 'return=minimal' }), body: JSON.stringify({ updated_at: new Date().toISOString() }) });
          }
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(timer); resolveP('err:' + st); }
      });
  });
  if (result === 'ok') ok('Realtime delivered a change in under 12 s');
  else if (result === 'no-event') bad('Subscribed, but no change event arrived', 'Run supabase/setup.sql (adds kfl_live to the supabase_realtime publication), or Database → Publications → supabase_realtime → enable kfl_live');
  else bad('Realtime connection failed (' + result + ')', 'Check SUPABASE_ANON_KEY and that Realtime is enabled for the project. Spectators will still work via the backup feed.');
  await client.removeAllChannels();
} catch (e) { bad('Realtime test error: ' + e.message, 'Spectators will still work via the backup feed'); }

console.log(failed ? `\n✖ ${failed} problem(s) found.\n` : '\n✔ All checks passed. Add the same variables to Vercel and deploy.\n');
process.exit(failed ? 1 : 0);
