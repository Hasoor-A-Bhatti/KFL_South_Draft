// POST /api/publish — the organiser console sends the draft state here.
// Protected by ORGANISER_PUBLISH_KEY (header X-KFL-Key).
import { cors, send, readJson, keyMatches, configProblem, getLive, putLive, putRoster, EVENT_ID, usingMemory } from './_lib/store.js';

export default async function handler(req, res) {
  cors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST' });

  try {
    if (!keyMatches(req.headers['x-kfl-key'])) return send(res, 401, { ok: false, error: 'Wrong organiser key' });
    const problem = configProblem();
    if (problem) return send(res, 500, { ok: false, error: problem });

    const body = await readJson(req);

    // Connection test from the "Go live" button.
    if (body.ping) {
      const current = await getLive();
      return send(res, 200, { ok: true, event: EVENT_ID, seq: Number(current?.seq) || 0, storage: usingMemory() ? 'memory' : 'supabase' });
    }

    const seq = Number(body.seq);
    if (!Number.isSafeInteger(seq) || seq <= 0) return send(res, 400, { ok: false, error: 'Invalid seq' });
    if (!body.live || typeof body.live !== 'object') return send(res, 400, { ok: false, error: 'Missing live state' });
    const rosterHash = String(body.rosterHash || '').slice(0, 64);
    if (!rosterHash) return send(res, 400, { ok: false, error: 'Missing roster hash' });

    if (body.roster) {
      if (!Array.isArray(body.roster.players) || !Array.isArray(body.roster.teams)) return send(res, 400, { ok: false, error: 'Invalid roster' });
      await putRoster(rosterHash, body.roster);
    }
    const result = await putLive(seq, body.live, rosterHash);
    return send(res, 200, result);
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : 500);
    return send(res, status, { ok: false, error: e.message || 'Server error' });
  }
}
