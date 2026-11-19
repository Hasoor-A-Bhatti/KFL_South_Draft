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
      '#kflActions{position:absolute;right:12px;bottom:10px;z-index:6;display:flex;gap:8px}',
      '#kflActions button{padding:6px 12px;border-radius:999px;background:#0b1428e6;border:1px solid #2c4470;color:#cfe3ff;font:700 12px Inter,"Segoe UI",Arial,sans-serif;cursor:pointer;white-space:nowrap}',
      '#kflActions button:hover{background:#16284d}',
      '#kflSquadBtn{background:linear-gradient(135deg,#2467db,#387eeb)!important;border-color:#6aa8ff!important;color:#fff!important}',
      // ----- squads panel -----
      '#kflSquads{position:absolute;top:0;right:0;bottom:0;width:min(460px,100%);z-index:8;display:flex;flex-direction:column;background:#0a1328f7;border-left:1px solid #2c4470;box-shadow:-18px 0 40px #0009;transform:translateX(105%);transition:transform .22s ease;backdrop-filter:blur(6px)}',
      '#kflSquads.open{transform:none}',
      '.sq-head{display:flex;align-items:center;gap:10px;padding:14px 16px 10px}',
      '.sq-head h2{margin:0;font-size:17px;letter-spacing:.03em;flex:1}',
      '.sq-close{width:34px;height:34px;border-radius:50%;border:1px solid #2c4470;background:#111d3a;color:#e8f2ff;font-size:16px;cursor:pointer}',
      '.sq-now{margin:0 16px 10px;padding:8px 11px;border-radius:10px;background:#11224a;border:1px solid #2c4a80;font-size:12px;color:#bcd3f2;display:flex;gap:8px;align-items:center;min-width:0}',
      '.sq-now b{color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sq-now .dot{width:8px;height:8px;border-radius:50%;background:#34d399;flex:none}',
      '.sq-tabs{display:flex;gap:6px;overflow-x:auto;padding:0 16px 10px;scrollbar-width:thin;flex:none}',
      '.sq-tab{flex:none;display:flex;align-items:center;gap:6px;padding:6px 10px 6px 7px;border-radius:999px;border:1px solid #2c4470;background:#0f1a34;color:#cfe0f7;font:700 12px Inter,"Segoe UI",Arial,sans-serif;cursor:pointer;white-space:nowrap}',
      '.sq-tab img{width:20px;height:20px;object-fit:contain}.sq-tab small{color:#8fb0d8;font-weight:600}',
      '.sq-tab.active{background:linear-gradient(135deg,#2467db,#387eeb);border-color:#7cb4ff;color:#fff}.sq-tab.active small{color:#dceaff}',
      '.sq-body{flex:1;overflow-y:auto;padding:4px 16px 18px;-webkit-overflow-scrolling:touch}',
      '.sq-team{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:linear-gradient(135deg,#17284f,#0f1a35);border:1px solid #2f4a7e;border-left:4px solid var(--tc,#5edbff);margin-bottom:10px}',
      '.sq-team img.crest{width:52px;height:56px;object-fit:contain;flex:none}',
      '.sq-team h3{margin:0;font-size:17px;line-height:1.15}.sq-team .cap{font-size:12px;color:#a9c0e0;margin-top:3px}',
      '.sq-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}',
      '.sq-stat{padding:9px 10px;border-radius:10px;background:#0f1a34;border:1px solid #23395f}.sq-stat b{display:block;font-size:18px;color:#7ee7ff}.sq-stat span{font-size:10px;letter-spacing:.08em;color:#8fa9cc;font-weight:700}',
      '.sq-row{display:flex;align-items:center;gap:11px;padding:8px 6px;border-bottom:1px solid #1c2c4d}',
      '.sq-num{width:20px;font-size:11px;color:#6f8bb3;font-weight:800;text-align:right;flex:none}',
      '.sq-photo{width:42px;height:42px;border-radius:9px;object-fit:cover;object-position:center 25%;background:#122747;border:1px solid #2f4a7e;flex:none}',
      '.sq-photo.logo{object-fit:contain;padding:4px;background:#000}',
      '.sq-info{flex:1;min-width:0}.sq-name{display:flex;align-items:center;min-width:0}.sq-name b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}.sq-info small{display:block;font-size:11px;color:#94afd3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sq-price{font-size:15px;font-weight:900;color:#7ee7ff;white-space:nowrap}.sq-price.free{font-size:11px;color:#91f2ba;letter-spacing:.06em;border:1px solid #2e7a59;border-radius:6px;padding:3px 6px}',
      '.sq-new{flex:none;font-size:9px;font-weight:900;letter-spacing:.08em;color:#071d28;background:#4ce3b2;border-radius:4px;padding:2px 5px;margin-left:6px}',
      '.sq-empty{padding:26px 10px;text-align:center;color:#8fa9cc;font-size:13px}',
      '.sq-ov{display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px;margin-bottom:8px;border-radius:12px;border:1px solid #23395f;border-left:4px solid var(--tc,#5edbff);background:#0f1a34;color:#e8f2ff;cursor:pointer;font:inherit}',
      '.sq-ov:hover{background:#16284d}.sq-ov img{width:34px;height:36px;object-fit:contain;flex:none}',
      '.sq-ov .n{flex:1;min-width:0}.sq-ov .n b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sq-ov .n small{font-size:11px;color:#94afd3}',
      '.sq-ov .m{text-align:right;font-size:11px;color:#94afd3;white-space:nowrap}.sq-ov .m b{display:block;font-size:15px;color:#7ee7ff}',
      '.sq-bar{display:block;height:4px;border-radius:3px;background:#1c2c4d;margin-top:5px;overflow:hidden}.sq-bar i{display:block;height:100%;background:linear-gradient(90deg,#2467db,#5edbff)}',
      '@media (max-width:700px),(max-height:520px){#kflSquads{width:100%;border-left:0}}',
      '#kflSpectator.sq-open #kflRotate{display:none!important}',
      '#kflWaiting{position:absolute;inset:0;display:none;align-items:center;justify-content:center;z-index:4;background:radial-gradient(ellipse at 50% 30%,#1b2c57,#060a16 70%)}',
      '#kflWaiting.show{display:flex}',
      '#kflWaiting .card{max-width:520px;margin:16px;text-align:center;padding:28px 24px;border-radius:18px;border:1px solid #2f4878;background:#0d1832cc}',
      '#kflWaiting img{width:92px;height:92px;object-fit:contain;border-radius:8px;background:#000;border:1px solid #40517a}',
      '#kflWaiting h1{font-size:22px;margin:16px 0 6px;letter-spacing:.04em}',
      '#kflWaiting p{margin:0;color:#a9c0e0;font-size:14px;line-height:1.5}',
      '#kflRotate{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:5;display:none;padding:7px 12px;border-radius:999px;background:#13306acc;border:1px solid #3d63a8;font-size:12px;font-weight:700;white-space:nowrap}',
      '@media (orientation:portrait) and (max-width:820px){#kflRotate{display:block}}',
      '@media (max-height:520px){#kflChip,#kflActions button{padding:3px 8px;font-size:10px}#kflChip{left:4px;bottom:4px;opacity:.85}#kflActions{right:4px;bottom:4px;gap:5px}}'
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
    var actions = h('div', { id: 'kflActions' });
    var sqBtn = h('button', { id: 'kflSquadBtn', type: 'button', 'aria-controls': 'kflSquads', 'aria-expanded': 'false' }, '👥 Squads');
    sqBtn.addEventListener('click', function () { toggleSquads(); });
    actions.appendChild(sqBtn);
    if (document.documentElement.requestFullscreen) {
      fsBtn = h('button', { id: 'kflFs', type: 'button' }, '⛶ Full screen');
      fsBtn.addEventListener('click', function () {
        if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
        else document.documentElement.requestFullscreen().catch(function () {});
      });
      actions.appendChild(fsBtn);
    }
    root.appendChild(actions);
    buildSquads();
    document.body.appendChild(root);
    waitingText = document.getElementById('kflWaitingText');
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', function () { setTimeout(fit, 250); });
    fit();
  }

  // ---------- squads panel (spectator-only, independent of the projector view) ----------
  var sqPanel, sqNow, sqTabs, sqBody, sqOpen = false, sqTeam = 'all';

  function buildSquads() {
    sqPanel = h('aside', { id: 'kflSquads', role: 'dialog', 'aria-label': 'Team squads', 'aria-hidden': 'true' });
    sqPanel.innerHTML = '<div class="sq-head"><h2>👥 Team squads</h2><button type="button" class="sq-close" aria-label="Close squads">✕</button></div>' +
      '<div class="sq-now" id="kflSqNow"></div><div class="sq-tabs" id="kflSqTabs" role="tablist"></div><div class="sq-body" id="kflSqBody"></div>';
    root.appendChild(sqPanel);
    sqNow = sqPanel.querySelector('#kflSqNow'); sqTabs = sqPanel.querySelector('#kflSqTabs'); sqBody = sqPanel.querySelector('#kflSqBody');
    sqPanel.querySelector('.sq-close').addEventListener('click', function () { toggleSquads(false); });
    sqPanel.addEventListener('click', function (e) {
      var pick = e.target.closest('[data-sq-team]');
      if (pick) { sqTeam = pick.getAttribute('data-sq-team'); sqBody.scrollTop = 0; renderSquads(true); }
    });
    window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sqOpen) toggleSquads(false); });
  }

  function toggleSquads(force) {
    sqOpen = typeof force === 'boolean' ? force : !sqOpen;
    sqPanel.classList.toggle('open', sqOpen);
    sqPanel.setAttribute('aria-hidden', sqOpen ? 'false' : 'true');
    root.classList.toggle('sq-open', sqOpen);
    var b = document.getElementById('kflSquadBtn');
    if (b) { b.setAttribute('aria-expanded', String(sqOpen)); b.textContent = sqOpen ? '✕ Close squads' : '👥 Squads'; }
    if (sqOpen) renderSquads(true);
  }

  /* eslint-disable no-undef */
  function crestImg(tid, cls) {
    var src = (typeof KFL_TEAM_CRESTS !== 'undefined' && KFL_TEAM_CRESTS[tid]) || '';
    return src ? '<img class="' + cls + '" alt="" src="' + esc(src) + '">' : '';
  }

  function teamPlayers(s, tid) {
    // Signing order: follow the sale history, then any others.
    var order = {}; (s.history || []).forEach(function (h, i) { if (h.teamId === tid) order[h.playerId] = i; });
    return s.players.filter(function (p) { return p.teamId === tid; }).sort(function (a, b) {
      return (order[a.id] === undefined ? 1e9 : order[a.id]) - (order[b.id] === undefined ? 1e9 : order[b.id]);
    });
  }

  function renderSquads(tabsToo) {
    if (!sqOpen || !haveState) {
      if (sqOpen && !haveState) sqBody.innerHTML = '<div class="sq-empty">Waiting for the live draft…</div>';
      return;
    }
    var s = E.getState(), target = KFL_SQUAD_TARGET || 15;
    if (sqTeam !== 'all' && !s.teams.some(function (t) { return t.id === sqTeam; })) sqTeam = 'all';

    // What's happening right now
    var cur = s.players.find(function (p) { return p.id === s.selectedPlayerId; });
    var top = topBid(s);
    sqNow.innerHTML = '<span class="dot"></span>' + (cur
      ? (cur.teamId ? 'Just signed: <b>' + esc(cur.name) + '</b>' : 'On the block: <b>' + esc(cur.name) + '</b>' + (top ? ' · ' + esc(money(top)) : ''))
      : 'Live draft in progress');

    if (tabsToo || sqTabs.childElementCount !== s.teams.length + 1) {
      sqTabs.innerHTML = '<button type="button" role="tab" class="sq-tab' + (sqTeam === 'all' ? ' active' : '') + '" data-sq-team="all">All teams</button>' +
        s.teams.map(function (t) {
          return '<button type="button" role="tab" class="sq-tab' + (sqTeam === t.id ? ' active' : '') + '" data-sq-team="' + esc(t.id) + '">' +
            crestImg(t.id, '') + esc(t.name) + ' <small>' + teamPlayers(s, t.id).length + '</small></button>';
        }).join('');
      var act = sqTabs.querySelector('.active'); if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'center' });
    } else {
      s.teams.forEach(function (t) {
        var sm = sqTabs.querySelector('[data-sq-team="' + t.id + '"] small');
        if (sm) sm.textContent = teamPlayers(s, t.id).length;
      });
    }

    if (sqTeam === 'all') {
      sqBody.innerHTML = s.teams.map(function (t) {
        var n = teamPlayers(s, t.id).length, left = teamRemaining(t.id);
        return '<button type="button" class="sq-ov" style="--tc:' + esc(t.color) + '" data-sq-team="' + esc(t.id) + '">' + crestImg(t.id, '') +
          '<span class="n"><b>' + esc(t.name) + '</b><small>Captain ' + esc(t.captain) + ' · ' + n + '/' + target + ' players</small>' +
          '<span class="sq-bar"><i style="width:' + Math.min(100, n / target * 100) + '%"></i></span></span>' +
          '<span class="m"><b>' + esc(money(left)) + '</b>left</span></button>';
      }).join('');
      return;
    }

    var t = s.teams.find(function (x) { return x.id === sqTeam; });
    var list = teamPlayers(s, t.id);
    var spent = list.reduce(function (a, p) { return a + (Number(p.price) || 0); }, 0);
    var newest = (s.history || []).filter(function (h) { return h.teamId === t.id; }).slice(-1)[0];
    var html = '<div class="sq-team" style="--tc:' + esc(t.color) + '">' + crestImg(t.id, 'crest') +
      '<div><h3>' + esc(t.name) + '</h3><div class="cap">Captain ' + esc(t.captain) + '</div></div></div>' +
      '<div class="sq-stats"><div class="sq-stat"><b>' + list.length + '/' + target + '</b><span>PLAYERS</span></div>' +
      '<div class="sq-stat"><b>' + esc(money(spent)) + '</b><span>SPENT</span></div>' +
      '<div class="sq-stat"><b>' + esc(money(teamRemaining(t.id))) + '</b><span>LEFT</span></div></div>';
    if (!list.length) html += '<div class="sq-empty">No players signed yet.</div>';
    html += list.map(function (p, i) {
      var photo = p.photo ? '<img class="sq-photo" loading="lazy" alt="" src="' + esc(p.photo) + '">' : '<img class="sq-photo logo" alt="" src="' + esc(KFL_LOGO) + '">';
      var isNew = newest && newest.playerId === p.id && i === list.length - 1;
      var meta = [p.position, p.age ? 'Age ' + p.age : '', p.region].filter(Boolean).join(' · ');
      var price = p.round === 2 ? '<span class="sq-price free">FREE PICK</span>' : '<span class="sq-price">' + esc(money(p.price)) + '</span>';
      return '<div class="sq-row"><span class="sq-num">' + (i + 1) + '</span>' + photo +
        '<div class="sq-info"><div class="sq-name"><b>' + esc(p.name) + '</b>' + (isNew ? '<span class="sq-new">LATEST</span>' : '') + '</div><small>' + esc(meta) + '</small></div>' + price + '</div>';
    }).join('');
    sqBody.innerHTML = html;
  }
  /* eslint-enable no-undef */

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
    try { renderSquads(false); } catch (e) { console.warn('[KFL spectator] squads panel', e); }
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
