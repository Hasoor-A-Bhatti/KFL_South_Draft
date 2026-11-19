// GET /api/state            → current live state (CDN-cached for 1 second)
// GET /api/state?roster=HASH → roster data (cached long, it is content-addressed)
// Spectators use this for the first load and as a fallback if Realtime drops.
import { cors, send, configProblem, getLive, getRoster } from './_lib/store.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Use GET' });

  try {
    const problem = configProblem();
    if (problem) return send(res, 500, { ok: false, error: problem }, { 'Cache-Control': 'no-store' });

    const url = new URL(req.url, 'http://local');
    const wanted = url.searchParams.get('roster');
    if (wanted) {
      const roster = await getRoster();
      const exact = roster?.hash && roster.hash === wanted;
      return send(res, 200, { ok: true, hash: roster?.hash || null, data: roster?.data || null }, exact
        ? { 'Cache-Control': 'public, max-age=86400, immutable', 'Vercel-CDN-Cache-Control': 'public, max-age=86400' }
        : { 'Cache-Control': 'no-cache', 'Vercel-CDN-Cache-Control': 'public, max-age=1' });
    }

    const live = await getLive();
    return send(res, 200, {
      ok: true,
      seq: Number(live?.seq) || 0,
      live: live?.live || null,
      roster_hash: live?.roster_hash || null,
      updated_at: live?.updated_at || null,
    }, {
      // Browsers always revalidate; Vercel's edge serves one cached copy per second to everyone,
      // so thousands of polling spectators cost about one Supabase read per second.
      'Cache-Control': 'no-cache',
      'Vercel-CDN-Cache-Control': 'public, max-age=1, stale-while-revalidate=2',
    });
  } catch (e) {
    return send(res, e.status || 500, { ok: false, error: e.message || 'Server error' }, { 'Cache-Control': 'no-store' });
  }
}
