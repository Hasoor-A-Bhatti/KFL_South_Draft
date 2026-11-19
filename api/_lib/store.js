// Storage for the live spectator state.
// Production: Supabase (PostgREST) using the server-only service/secret key.
// Local dev without Supabase keys: an in-memory store (dev server only).
import { timingSafeEqual } from 'node:crypto';

export const EVENT_ID = (process.env.KFL_EVENT_ID || 'kfl-south').trim();
const MAX_BODY_BYTES = 900 * 1024;

const supabaseUrl = () => (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();

export function usingMemory() {
  return !supabaseUrl() || !serviceKey();
}

export function configProblem() {
  if (!usingMemory()) return '';
  if (process.env.KFL_ALLOW_MEMORY_STORE === '1') return '';
  return 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them in Vercel → Settings → Environment Variables, then redeploy.';
}

// ---------- helpers ----------
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-KFL-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function send(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (text.length > MAX_BODY_BYTES) throw httpError(413, 'Payload too large');
    return JSON.parse(text);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, 'Payload too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function keyMatches(given) {
  const expected = (process.env.ORGANISER_PUBLISH_KEY || '').trim();
  if (!expected) throw httpError(500, 'Server is missing ORGANISER_PUBLISH_KEY. Add it in Vercel → Settings → Environment Variables, then redeploy.');
  const a = Buffer.from(String(given || '').trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Supabase REST ----------
function headers(extra = {}) {
  const key = serviceKey();
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  // Legacy JWT keys go in Authorization too; new sb_secret_ keys must not.
  if (!key.startsWith('sb_')) h.Authorization = 'Bearer ' + key;
  return h;
}

async function rest(path, init = {}) {
  const r = await fetch(supabaseUrl() + '/rest/v1/' + path, { ...init, headers: headers(init.headers) });
  const text = await r.text();
  if (!r.ok) {
    let detail = text.slice(0, 300);
    if (r.status === 404 && /relation|does not exist|schema cache/i.test(text)) detail = 'Tables not found — run supabase/setup.sql in the Supabase SQL Editor.';
    if (r.status === 401 || r.status === 403) detail = 'Supabase rejected the service key — check SUPABASE_SERVICE_ROLE_KEY. ' + detail;
    throw httpError(502, 'Supabase error ' + r.status + ': ' + detail);
  }
  return text ? JSON.parse(text) : null;
}

// ---------- memory store (local dev only) ----------
const mem = globalThis.__kflMemStore || (globalThis.__kflMemStore = {
  live: { id: EVENT_ID, seq: 0, live: null, roster_hash: null, updated_at: new Date().toISOString() },
  roster: { id: EVENT_ID, hash: null, data: null, updated_at: new Date().toISOString() },
});

// ---------- public API ----------
const enc = encodeURIComponent;

export async function getLive() {
  if (usingMemory()) return { ...mem.live };
  const rows = await rest(`kfl_live?id=eq.${enc(EVENT_ID)}&select=id,seq,live,roster_hash,updated_at`);
  return rows?.[0] || null;
}

export async function getRoster() {
  if (usingMemory()) return { ...mem.roster };
  const rows = await rest(`kfl_roster?id=eq.${enc(EVENT_ID)}&select=id,hash,data,updated_at`);
  return rows?.[0] || null;
}

export async function putRoster(hash, data) {
  const row = { id: EVENT_ID, hash, data, updated_at: new Date().toISOString() };
  if (usingMemory()) { mem.roster = row; return; }
  await rest('kfl_roster?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
  });
}

// Writes only if seq is newer than what is stored. Returns { ok, stale, seq }.
export async function putLive(seq, live, rosterHash) {
  const row = { seq, live, roster_hash: rosterHash, updated_at: new Date().toISOString() };
  if (usingMemory()) {
    if (seq <= mem.live.seq) return { ok: false, stale: true, seq: mem.live.seq };
    mem.live = { id: EVENT_ID, ...row };
    return { ok: true, seq };
  }
  const updated = await rest(`kfl_live?id=eq.${enc(EVENT_ID)}&seq=lt.${seq}&select=seq`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (Array.isArray(updated) && updated.length) return { ok: true, seq };
  const current = await getLive();
  if (current) return { ok: false, stale: true, seq: Number(current.seq) || 0 };
  // Row missing (setup.sql seed skipped) — create it.
  await rest('kfl_live?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ id: EVENT_ID, ...row }),
  });
  return { ok: true, seq };
}
