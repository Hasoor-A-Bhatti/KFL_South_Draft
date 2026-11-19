/* KFL spectator view. Runs AFTER the draft engine.
 * Receives the organiser's state (Supabase Realtime, with a CDN-cached polling
 * fallback) and renders it with the engine's own projector scenes, so viewers
 * see exactly what the venue projector shows — animations included.
 */
(function () {
  'use strict';
  var CFG = window.KFL_LIVE_CONFIG || {};
  var EVENT = CFG.eventId || 'kfl-south';
  var STAGE_W = 1600, STAGE_H = 900;

  // ---------- engine access (top-level `let`/`const` of the engine script) ----------
  /* eslint-disable no-undef */
  var E = {
    getState: function () { return state; },
    setState: function (s) { state = s; },
    setBreak: function (v) { breakScreenActive = v; },
    setSquadPage: function (v) { squadPage = v; },
    getActiveSold: function () { return activeSold; },
    validate: function (o) { return validateLoaded(o); },
    photos: KFL_PPTX_PHOTOS
  };
  /* eslint-enable no-undef */

  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return ''; } }

  // ---------- page chrome ----------
  var root, stageBox, frame, chip, chipDot, chipText, waiting, waitingText, rotateHint, fsBtn;

  function h(tag, attrs, html) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (html) e.innerHTML = html;
    return e;
  }

  function buildChrome() {
    var style = h('style');
    style.textContent = [
      '#kflSpectator{position:fixed;inset:0;background:#060a16;font-family:Inter,"Segoe UI",Arial,sans-serif;color:#e8f2ff;overflow:hidden}',
      '#kflStageBox{position:absolute;left:0;top:0;width:' + STAGE_W + 'px;height:' + STAGE_H + 'px;transform-origin:0 0;overflow:hidden;border-radius:6px;box-shadow:0 0 0 1px #1d2b4a}',
      '#kflStageFrame{width:100%;height:100%;border:0;display:block;background:#090e1e}',
      '#kflChip{position:absolute;left:12px;bottom:10px;display:flex;align-items:center;gap:8px;padding:6px 11px;border-radius:999px;background:#0b1428e6;border:1px solid #2c4470;font-size:12px;font-weight:700;letter-spacing:.03em;z-index:5;pointer-events:none}',
      '#kflChip i{width:9px;height:9px;border-radius:50%;background:#f6c453;display:block}',
      '#kflChip.live i{background:#34d399;box-shadow:0 0 0 3px #34d39933;animation:kflPulse 2s infinite}',
      '#kflChip.bad i{background:#fb923c}',
      '@keyframes kflPulse{50%{box-shadow:0 0 0 6px #34d39911}}',
      '#kflFs{position:absolute;right:12px;bottom:10px;z-index:5;padding:6px 11px;border-radius:999px;background:#0b1428e6;border:1px solid #2c4470;color:#cfe3ff;font:700 12px Inter,"Segoe UI",Arial,sans-serif;cursor:pointer}',
      '#kflWaiting{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:4;background:radial-gradient(ellipse at 50% 30%,#1b2c57,#060a16 70%)}',
      '#kflWaiting.show{display:flex}',
      '#kflWaiting .card{max-width:520px;margin:16px;text-align:center;padding:28px 24px;border-radius:18px;border:1px solid #2f4878;background:#0d1832cc}',
      '#kflWaiting img{width:92px;height:92px;object-fit:contain;border-radius:8px;background:#000;border:1px solid #40517a}',
      '#kflWaiting h1{font-size:22px;margin:16px 0 6px;letter-spacing:.04em}',
      '#kflWaiting p{margin:0;color:#a9c0e0;font-size:14px;line-height:1.5}',
      '#kflRotate{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:5;display:none;padding:7px 12px;border-radius:999px;background:#13306acc;border:1px solid #3d63a8;font-size:12px;font-weight:700;white-space:nowrap}',
      '@media (orientation:portrait) and (max-width:820px){#kflRotate{display:block}}',
      '@media (max-height:520px){#kflChip,#kflFs{padding:3px 8px;font-size:10px;bottom:4px;opacity:.8}#kflChip{left:4px}#kflFs{right:4px}}'
    ].join('\n');
    document.head.appendChild(style);

    root = h('div', { id: 'kflSpectator', 'data-kfl-spectator-ui': '' });
    stageBox = h('div', { id: 'kflStageBox' });
    frame = h('iframe', { id: 'kflStageFrame', title: 'KFL live draft', scrolling: 'no', tabindex: '-1' });
    stageBox.appendChild(frame);
    chip = h('div', { id: 'kflChip', role: 'status', 'aria-live': 'polite' });
    chipDot = h('i'); chipText = h('span'); chip.appendChild(chipDot); chip.appendChild(chipText);
    waiting = h('div', { id: 'kflWaiting' });
    var logo = '';
    try { logo = KFL_LOGO; } catch (e) {} // eslint-disable-line no-undef
    waiting.innerHTML = '<div class="card">' + (logo ? '<img alt="KFL" src="' + logo + '">' : '') +
      '<h1>KFL SOUTH · LIVE DRAFT</h1><p id="kflWaitingText">Connecting…</p></div>';
    rotateHint = h('div', { id: 'kflRotate' }, '↻ Rotate your phone for a bigger view');
    root.appendChild(stageBox); root.appendChild(waiting); root.appendChild(chip); root.appendChild(rotateHint);
    if (document.documentElement.requestFullscreen) {
      fsBtn = h('button', { id: 'kflFs', type: 'button' }, '⛶ Full screen');
      fsBtn.addEventListener('click', function () {
        if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
        else document.documentElement.requestFullscreen().catch(function () {});
      });
      root.appendChild(fsBtn);
    }
    document.body.appendChild(root);
    waitingText = document.getElementById('kflWaitingText');
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', function () { setTimeout(fit, 250); });
    fit();
  }

  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / STAGE_W, vh / STAGE_H);
    var x = Math.max(0, (vw - STAGE_W * s) / 2), y = Math.max(0, (vh - STAGE_H * s) / 2);
    stageBox.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  }

  // The engine calls window.open('', 'KFLAudience') → we return the frame's window.
  window.__kflStageWindow = function () { return frame.contentWindow; };

  function openStage() {
    openAudience(); // eslint-disable-line no-undef
    var w = frame.contentWindow, d = w.document;
    var css = d.createElement('style');
    css.textContent = '#audiencePrev,#audienceNext,#fullscreenAudience{display:none!important}html,body{overflow:hidden!important}';
    d.head.appendChild(css);
    ['keydown', 'keyup', 'keypress'].forEach(function (t) {
      w.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
    });
  }

  // ---------- status ----------
  var rtState = 'off', lastAppliedAt = 0, haveState = false, fetchFailures = 0;

  function paint() {
    var cls = '', text;
    if (!haveState) { text = 'Connecting…'; }
    else if (rtState === 'SUBSCRIBED') { cls = 'live'; text = 'LIVE'; }
    else if (!CFG.supabaseUrl) { cls = fetchFailures ? 'bad' : 'live'; text = fetchFailures ? 'Reconnecting…' : 'LIVE'; }
    else { cls = fetchFailures ? 'bad' : 'live'; text = fetchFailures ? 'Reconnecting… showing last update' : 'LIVE · backup feed'; }
    chip.className = cls;
    chipText.textContent = text;
  }

  function showWaiting(msg) {
    waiting.classList.toggle('show', !!msg);
    if (msg) waitingText.textContent = msg;
  }

  // ---------- data ----------
  var cur = { seq: 0 }, roster = { hash: null, data: null }, pending = null, busy = false;

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' }).then(function (r) {
      return r.json().then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
    });
  }

  function loadRoster(hash) {
    if (roster.hash === hash && roster.data) return Promise.resolve();
    return getJSON('/api/state?roster=' + encodeURIComponent(hash)).then(function (j) {
      if (j.data && Array.isArray(j.data.players)) roster = { hash: j.hash, data: j.data };
    });
  }

  function offer(row) {
    if (!row) return;
    var seq = Number(row.seq) || 0;
    if (!row.live) {
      if (!haveState) showWaiting('The draft hasn’t started broadcasting yet. Keep this page open — it updates automatically.');
      return;
    }
    if (seq <= cur.seq) return;
    if (!pending || seq > pending.seq) pending = { seq: seq, live: row.live, roster_hash: row.roster_hash };
    pump();
  }

  function pump() {
    if (busy || !pending) return;
    var row = pending; pending = null; busy = true;
    loadRoster(row.roster_hash).then(function () {
      if (!roster.data) throw new Error('Roster not available yet');
      try { if (row.seq > cur.seq) apply(row); }
      catch (e) { console.error('[KFL spectator] could not apply update', e); } // skip a bad update, keep going
      busy = false; pump();
    }, function (e) {
      console.warn('[KFL spectator] roster fetch failed, retrying', e);
      if (!pending) pending = row;
      setTimeout(function () { busy = false; pump(); }, 1500);
    });
  }

  function apply(row) {
    var live = row.live, data = roster.data;
    var rosterById = {};
    var players = data.players.map(function (p) {
      rosterById[p.id] = p;
      var c = {}; for (var k in p) c[k] = p[k];
      c.photo = ''; c.teamId = null; c.price = null; c.round = null;
      return c;
    });
    var byId = {}; players.forEach(function (p) { byId[p.id] = p; });
    (live.alloc || []).forEach(function (a) {
      var p = byId[a[0]];
      if (p && a[1]) { p.teamId = a[1]; p.price = a[2]; p.round = a[3]; }
    });
    var full = {};
    for (var k in live) full[k] = live[k];
    full.teams = data.teams; full.players = players;
    full.undoStack = []; full.redoStack = []; full.auditLog = []; full.checkpoint = null;

    var next = E.validate(full);
    next.players.forEach(function (p) {
      var r = rosterById[p.id];
      var src = (r && r.hasPhoto === false) ? '' : E.photos[p.name];
      p.photo = src ? abs(src) : '';
    });
    next.autoAdvanceOn = false; // spectators never advance players themselves

    var prev = haveState ? E.getState() : null;
    var events = prev ? diff(prev, next) : null;

    E.setState(next);
    E.setBreak(!!live.intermission);
    if (live.squadPage === 0 || live.squadPage === 1) E.setSquadPage(live.squadPage);

    // Organiser moved on while a SOLD/UNSOLD overlay was still playing → clear it, like the projector.
    var act = E.getActiveSold();
    if (prev && act && prev.selectedPlayerId !== next.selectedPlayerId && act.pid !== next.selectedPlayerId) clearSoldAnimation(); // eslint-disable-line no-undef

    updateAudience(); // eslint-disable-line no-undef
    cur.seq = row.seq; haveState = true; lastAppliedAt = Date.now(); fetchFailures = 0;
    showWaiting('');
    paint();
    if (events) animate(events, prev, next);
  }

  function diff(prev, next) {
    var pmap = {}; prev.players.forEach(function (p) { pmap[p.id] = p; });
    var signed = [], reversed = [];
    next.players.forEach(function (p) {
      var o = pmap[p.id];
      if (!o) return;
      if (p.teamId && !o.teamId) signed.push(p);
      if (!p.teamId && o.teamId) reversed.push({ p: p, team: o.teamId, price: o.price });
    });
    var prevUnsold = prev.unsoldIds || [];
    var newUnsold = (next.unsoldIds || []).filter(function (id) { return prevUnsold.indexOf(id) < 0; });
    var prevMax = 0; prev.players.forEach(function (p) { if (p.teamId) prevMax = Math.max(prevMax, Number(p.price) || 0); });
    var prevTop = topBid(prev), nextTop = topBid(next);
    return { signed: signed, reversed: reversed, newUnsold: newUnsold, prevMax: prevMax,
      bidUp: prev.selectedPlayerId === next.selectedPlayerId && nextTop > prevTop };
  }

  function topBid(s) {
    var b = (s.bidBoard && s.bidBoard.bids) || {}, m = 0;
    for (var k in b) m = Math.max(m, Number(b[k]) || 0);
    return m;
  }

  function animate(ev, prev, next) {
    /* eslint-disable no-undef */
    try {
      if (ev.signed.length === 1 && !ev.reversed.length) {
        var p = ev.signed[0], t = teamById(p.teamId);
        if (!t) return;
        if (p.round === 2) {
          clearSoldAnimation();
          var o = overlayAudience('phase-sold', '<div class="kfl-sold-word">FREE PICK</div><div class="kfl-sold-name">' + esc(p.name) +
            '</div><div class="kfl-sold-amount">0M</div><div class="kfl-sold-team">' + teamCrest(p.teamId, 'kfl-sold-large-crest') + esc(t.name) +
            '</div><div class="kfl-sold-captain">ROUND 2 · NO BUDGET DEDUCTION</div>');
          if (o) timed(function () { o.remove(); }, 1700);
          return;
        }
        var count = next.players.filter(function (q) { return q.teamId === p.teamId; }).length;
        var isRecord = ev.prevMax > 0 && Number(p.price) > ev.prevMax;
        playSoldAnimation(p.id, p.teamId, p.price, true, isRecord, count === KFL_SQUAD_TARGET);
        return;
      }
      if (ev.newUnsold.length === 1 && !ev.signed.length) { playUnsoldAnimation(ev.newUnsold[0]); return; }
      if (ev.reversed.length === 1 && !ev.signed.length) {
        var r = ev.reversed[0], team = prev.teams.find(function (x) { return x.id === r.team; });
        playReversedAnimation(r.p.name, team ? team.name : 'Team', r.price);
        return;
      }
      if (ev.bidUp) pulseBid();
    } catch (e) { console.warn('[KFL spectator] animation skipped', e); }
    /* eslint-enable no-undef */
  }

  // ---------- transport ----------
  var pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    getJSON('/api/state').then(function (j) {
      fetchFailures = 0;
      offer(j);
      if (!j.live && !haveState) showWaiting('The draft hasn’t started broadcasting yet. Keep this page open — it updates automatically.');
    }).catch(function (e) {
      fetchFailures++;
      console.warn('[KFL spectator] fetch failed', e);
      if (!haveState) showWaiting('Can’t reach the live feed yet — retrying…');
    }).finally(function () {
      paint();
      var every = rtState === 'SUBSCRIBED' ? 15000 : 1200;
      if (document.hidden) every = Math.max(every, 10000);
      pollTimer = setTimeout(poll, every);
    });
  }

  function startRealtime() {
    if (!CFG.supabaseUrl || !CFG.supabaseKey || !window.supabase || !window.supabase.createClient) return;
    try {
      var client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 20 } }
      });
      client.channel('kfl-live-' + EVENT)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kfl_live', filter: 'id=eq.' + EVENT }, function (payload) {
          var row = payload && payload.new;
          if (row && row.live && row.seq) offer(row); else poll();
        })
        .subscribe(function (st) {
          var was = rtState; rtState = st; paint();
          if (st === 'SUBSCRIBED' && was !== 'SUBSCRIBED') poll(); // catch anything missed while connecting
          if (st !== 'SUBSCRIBED') { clearTimeout(pollTimer); pollTimer = setTimeout(poll, 1500); }
        });
    } catch (e) { console.warn('[KFL spectator] realtime unavailable, using backup feed', e); }
  }

  // ---------- start ----------
  function start() {
    // Make built-in photo paths absolute (the engine only accepts http(s) photo URLs).
    for (var n in E.photos) if (E.photos[n] && E.photos[n].charAt(0) === '/') E.photos[n] = abs(E.photos[n]);
    buildChrome();
    openStage();
    showWaiting('Connecting to the live draft…');
    paint();
    poll();
    startRealtime();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  }

  window.KFLSpectator = { status: function () { return { seq: cur.seq, realtime: rtState, haveState: haveState, lastAppliedAt: lastAppliedAt }; } };
  start();
})();
