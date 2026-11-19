/* KFL live broadcast add-on for the organiser console.
 * Read-only observer: every 250 ms it looks at the draft `state` and, if
 * anything changed, sends a compact copy to /api/publish. It never modifies
 * the draft, and any network failure is contained here (the draft carries on
 * offline; sending resumes automatically when the connection returns).
 */
(function () {
  'use strict';
  if (window.__kflPublisherStarted) return;
  window.__kflPublisherStarted = true;

  var CFG = window.KFL_LIVE_CONFIG || {};
  var LS_KEY = 'kfl-live-publish-key';
  var LS_ON = 'kfl-live-publish-on';
  var TICK_MS = 250, MIN_GAP_MS = 300, ROSTER_CHECK_MS = 1000;

  function endpoint() {
    if (/^https?:$/.test(location.protocol)) return location.origin;
    return (CFG.endpoint || '').replace(/\/+$/, '');
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function getState() { try { return state; } catch (e) { return null; } }            // eslint-disable-line no-undef
  function getBreak() { try { return !!breakScreenActive; } catch (e) { return false; } } // eslint-disable-line no-undef
  function getSquadPage() { try { return squadPage; } catch (e) { return 0; } }          // eslint-disable-line no-undef

  // ---------- payload ----------
  function hash(str) { // FNV-1a, 2 rounds → 16 hex chars
    var h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619);
      h2 = Math.imul(h2 ^ c, 2246822519);
    }
    return ('0000000' + (h1 >>> 0).toString(16)).slice(-8) + ('0000000' + (h2 >>> 0).toString(16)).slice(-8);
  }

  function buildRoster(s) {
    return {
      v: 1,
      teams: s.teams.map(function (t) { return { id: t.id, name: t.name, captain: t.captain }; }),
      players: s.players.map(function (p) {
        return {
          id: p.id, name: p.name, age: p.age, region: p.region, position: p.position, majlis: p.majlis,
          availability: p.availability, slideNo: p.slideNo, source: p.source, basePrice: p.basePrice,
          photoSettings: p.photoSettings, hasPhoto: !!p.photo
        };
      })
    };
  }

  function buildLive(s) {
    var bb = s.bidBoard || {};
    return {
      v: 1,
      alloc: s.players.map(function (p) { return p.teamId ? [p.id, p.teamId, p.price, p.round] : [p.id]; }),
      history: (s.history || []).filter(function (h) { return h && h.kind === 'sale'; })
        .map(function (h) { return { kind: 'sale', playerId: h.playerId, teamId: h.teamId, amount: h.amount, round: h.round, at: h.at }; }),
      selectedPlayerId: s.selectedPlayerId, liveBid: s.liveBid, pendingTeamId: s.pendingTeamId,
      bidBoard: { playerId: bb.playerId, bids: bb.bids || {}, increment: bb.increment, history: [], deskOrder: bb.deskOrder },
      audienceMode: s.audienceMode, focusTeamId: s.focusTeamId, squadAutoFlip: s.squadAutoFlip,
      budgetSort: s.budgetSort, roundMode: s.roundMode, previewNext: s.previewNext, lowEffects: s.lowEffects,
      liveSidebarTop: s.liveSidebarTop, liveSidebarBottom: s.liveSidebarBottom, soldAnimationOn: s.soldAnimationOn,
      animationFlags: s.animationFlags, animationSpeed: s.animationSpeed, unsoldIds: s.unsoldIds || [],
      displayConfig: s.displayConfig,
      intermission: getBreak(),
      squadPage: s.squadAutoFlip === false ? getSquadPage() : null
    };
  }

  // ---------- network ----------
  var key = lsGet(LS_KEY) || '';
  var on = lsGet(LS_ON) === '1' && !!key;
  var seq = 0, inFlight = false, lastSentAt = 0, lastLiveStr = '', rosterSentHash = '';
  var rosterCache = { at: 0, hash: '', obj: null };
  var status = on ? 'connecting' : 'off', statusDetail = '', lastOkAt = 0, failCount = 0, retryAt = 0;

  function nextSeq() { seq = Math.max(Date.now(), seq + 1); return seq; }

  function post(body) {
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 10000);
    return fetch(endpoint() + '/api/publish', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-KFL-Key': key },
      body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; })
        .then(function (j) { j.httpStatus = r.status; return j; });
    }).finally(function () { clearTimeout(timer); });
  }

  function connect(newKey) {
    if (newKey !== undefined) key = String(newKey || '').trim();
    if (!key) { setStatus('off'); return; }
    if (!endpoint()) { setStatus('error', 'No server address. Open the organiser from your Vercel site.'); return; }
    setStatus('connecting');
    inFlight = true;
    post({ ping: true }).then(function (j) {
      if (j.httpStatus === 401) { on = false; lsSet(LS_ON, null); setStatus('error', 'Wrong organiser key'); return; }
      if (!j.ok) throw new Error(j.error || 'Server error');
      seq = Math.max(seq, Number(j.seq) || 0);
      on = true; lsSet(LS_KEY, key); lsSet(LS_ON, '1');
      lastLiveStr = ''; rosterSentHash = ''; failCount = 0;
      setStatus('live', j.storage === 'memory' ? 'local test mode' : '');
    }).catch(function (e) {
      on = true; lsSet(LS_ON, '1');
      failure(e);
    }).finally(function () { inFlight = false; });
  }

  function failure(e) {
    failCount++;
    retryAt = Date.now() + Math.min(15000, 1000 * Math.pow(2, Math.min(failCount, 4)));
    setStatus('retry', (e && e.message ? e.message : 'Network error').slice(0, 140));
  }

  function tick() {
    if (!on || inFlight || Date.now() < retryAt) return;
    if (Date.now() - lastSentAt < MIN_GAP_MS) return;
    var s = getState();
    if (!s || !Array.isArray(s.players) || !Array.isArray(s.teams)) return;
    var now = Date.now();
    if (now - rosterCache.at > ROSTER_CHECK_MS || !rosterCache.obj) {
      var r = buildRoster(s), rs = JSON.stringify(r);
      rosterCache = { at: now, hash: hash(rs), obj: r };
    }
    var live = buildLive(s), liveStr = JSON.stringify(live);
    var rosterChanged = rosterCache.hash !== rosterSentHash;
    if (!rosterChanged && liveStr === lastLiveStr && status === 'live') return;
    var body = { seq: nextSeq(), rosterHash: rosterCache.hash, live: live };
    if (rosterChanged) body.roster = rosterCache.obj;
    var sentHash = rosterCache.hash;
    inFlight = true; lastSentAt = now;
    post(body).then(function (j) {
      if (j.httpStatus === 401) { on = false; lsSet(LS_ON, null); setStatus('error', 'Organiser key no longer accepted'); return; }
      if (j.stale) { seq = Math.max(seq, Number(j.seq) || 0); lastLiveStr = ''; return; } // resend with a newer seq next tick
      if (!j.ok) throw new Error(j.error || 'Server error');
      lastLiveStr = liveStr; rosterSentHash = sentHash; failCount = 0; retryAt = 0; lastOkAt = Date.now();
      setStatus('live');
    }).catch(failure).finally(function () { inFlight = false; });
  }

  function pause() { on = false; lsSet(LS_ON, null); setStatus('off'); }
  function forget() { pause(); key = ''; lsSet(LS_KEY, null); }

  // ---------- UI ----------
  var panel, dot, label, detail, btn, menuBtn;
  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }

  function buildPanel() {
    var old = document.getElementById('kflLivePanel'); if (old) old.remove();
    panel = el('div', 'position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:12px;background:#0d1a33f2;border:1px solid #3d5a8c;box-shadow:0 8px 24px #0008;font:600 12px/1.25 Inter,"Segoe UI",Arial,sans-serif;color:#e8f2ff;max-width:min(440px,calc(100vw - 28px))');
    panel.id = 'kflLivePanel';
    dot = el('span', 'width:11px;height:11px;border-radius:50%;flex:none;background:#64748b');
    var txt = el('div', 'display:flex;flex-direction:column;min-width:0');
    label = el('strong', 'font-size:12px;letter-spacing:.04em;white-space:nowrap');
    detail = el('small', 'font-size:11px;font-weight:500;color:#a9c0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    txt.appendChild(label); txt.appendChild(detail);
    btn = el('button', 'margin-left:auto;padding:7px 11px;border-radius:8px;border:1px solid #5d84c4;background:#1f4f91;color:#fff;font:700 12px Inter,"Segoe UI",Arial,sans-serif;cursor:pointer;white-space:nowrap');
    btn.type = 'button';
    menuBtn = el('button', 'padding:7px 8px;border-radius:8px;border:1px solid #3d5a8c;background:transparent;color:#a9c0e0;font:700 12px Inter,"Segoe UI",Arial,sans-serif;cursor:pointer');
    menuBtn.type = 'button'; menuBtn.textContent = '⋯'; menuBtn.title = 'Spectator broadcast options';
    btn.addEventListener('click', function (e) { e.stopPropagation(); onButton(); });
    menuBtn.addEventListener('click', function (e) { e.stopPropagation(); onMenu(); });
    panel.appendChild(dot); panel.appendChild(txt); panel.appendChild(btn); panel.appendChild(menuBtn);
    document.body.appendChild(panel);
    paint();
  }

  function onButton() {
    if (status === 'off' || status === 'error') {
      var k = key;
      if (!k || status === 'error') {
        k = window.prompt('Organiser key (ORGANISER_PUBLISH_KEY) to broadcast to spectators:', '');
        if (k === null) return;
      }
      connect(k);
    } else {
      if (window.confirm('Stop sending updates to spectators?\n\nThe draft continues normally on this laptop. Spectators will see the last update until you go live again.')) pause();
    }
  }

  function onMenu() {
    var site = endpoint() || '(not set)';
    var choice = window.prompt(
      'Spectator broadcast\n\nSpectator link: ' + site + '/\n\nType a number:\n 1 = Resend everything now\n 2 = Change organiser key\n 3 = Forget key on this laptop', '');
    if (choice === null) return;
    choice = String(choice).trim();
    if (choice === '1') { lastLiveStr = ''; rosterSentHash = ''; retryAt = 0; if (!on && key) connect(); }
    else if (choice === '2') { var k = window.prompt('New organiser key:', ''); if (k !== null) connect(k); }
    else if (choice === '3') forget();
  }

  function setStatus(s, d) { status = s; statusDetail = d || ''; paint(); }

  function paint() {
    if (!panel) return;
    var map = {
      off: ['#64748b', 'SPECTATORS: OFF', 'Not broadcasting', 'Go live'],
      connecting: ['#f6c453', 'CONNECTING…', 'Contacting server', 'Stop'],
      live: ['#34d399', '● LIVE TO SPECTATORS', '', 'Stop'],
      retry: ['#fb923c', 'RECONNECTING…', '', 'Stop'],
      error: ['#f87171', 'BROADCAST ERROR', '', 'Retry']
    }[status];
    dot.style.background = map[0];
    dot.style.boxShadow = status === 'live' ? '0 0 0 4px #34d39933' : 'none';
    label.textContent = map[1];
    var d = statusDetail || map[2];
    if (status === 'live' && lastOkAt) d = (statusDetail ? statusDetail + ' · ' : '') + 'last update ' + new Date(lastOkAt).toLocaleTimeString('en-GB');
    if (status === 'retry') d = 'Draft is safe offline · ' + (statusDetail || 'retrying');
    detail.textContent = d;
    detail.title = d;
    btn.textContent = map[3];
  }

  function start() {
    buildPanel();
    setInterval(function () { try { tick(); } catch (e) { failure(e); } }, TICK_MS);
    setInterval(paint, 5000);
    window.addEventListener('online', function () { retryAt = 0; });
    if (on) connect();
  }

  window.KFLLive = { status: function () { return { status: status, detail: statusDetail, seq: seq, lastOkAt: lastOkAt }; }, connect: connect, pause: pause };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
