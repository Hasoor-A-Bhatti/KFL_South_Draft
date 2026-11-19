/* Runs BEFORE the draft engine on the spectator page.
 * Makes the engine safe to run read-only in a viewer's browser:
 *  - storage is in-memory only (never touches an organiser's autosave on the same device)
 *  - no photo database access, no dialogs, no pop-ups, no keyboard shortcuts
 *  - the "audience window" is an in-page frame instead of a pop-up
 */
(function () {
  'use strict';
  window.__KFL_SPECTATOR = true;

  function MemoryStorage() {
    var m = new Map();
    return {
      getItem: function (k) { k = String(k); return m.has(k) ? m.get(k) : null; },
      setItem: function (k, v) { m.set(String(k), String(v)); },
      removeItem: function (k) { m.delete(String(k)); },
      clear: function () { m.clear(); },
      key: function (i) { return Array.from(m.keys())[i] || null; },
      get length() { return m.size; }
    };
  }
  try { Object.defineProperty(window, 'localStorage', { configurable: true, value: MemoryStorage() }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { configurable: true, value: MemoryStorage() }); } catch (e) {}
  try { Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined }); } catch (e) {}

  window.alert = function () {};
  window.confirm = function () { return false; };
  window.prompt = function () { return null; };

  // The engine opens its projector screen with window.open('', 'KFLAudience').
  // Hand it our full-page frame instead.
  window.open = function (url, name) {
    if (name === 'KFLAudience' && typeof window.__kflStageWindow === 'function') return window.__kflStageWindow();
    return null;
  };

  // Spectators must not trigger organiser shortcuts (N, R, B, 1–5 …).
  function swallow(e) {
    if (e.target && e.target.closest && e.target.closest('[data-kfl-spectator-ui]')) return;
    e.stopImmediatePropagation();
  }
  ['keydown', 'keyup', 'keypress'].forEach(function (t) { window.addEventListener(t, swallow, true); });

  // Hide the organiser console; only the spectator stage is visible.
  var css = document.createElement('style');
  css.textContent =
    'html,body{margin:0!important;height:100%!important;overflow:hidden!important;background:#060a16!important}' +
    'body>*:not(#kflSpectator){display:none!important}';
  document.head.appendChild(css);
})();
