/* =========================================================
   NOVA — global money formatter.
   Reads the store currency from /api/settings at load
   (saved in the admin panel → الإعدادات → العملة).
   Exposes window.novaMoney(n) and window.NOVA_MONEY.ready.
   ========================================================= */
(function () {
  'use strict';

  var CFG = {
    USD: { sym: '$', suffix: false, gap: false },
    EUR: { sym: '\u20ac', suffix: true, gap: true },
    KWD: { sym: '\u062f.\u0643', suffix: false, gap: true }
  };
  var current = CFG.USD;
  var done = false;
  var resolveReady;
  var ready = new Promise(function (r) { resolveReady = r; });

  function money(n) {
    var num = (Number(n) || 0).toLocaleString('en-US');
    var c = current;
    return c.suffix
      ? num + (c.gap ? ' ' : '') + c.sym
      : c.sym + (c.gap ? ' ' : '') + num;
  }

  function trigger() {
    if (done) return;
    done = true;
    resolveReady();
    window.dispatchEvent(new CustomEvent('nova:money'));
  }

  function load() {
    fetch('/api/settings', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (s && s.currency && CFG[s.currency]) current = CFG[s.currency];
      })
      .catch(function () { /* keep default USD */ })
      .then(trigger);
  }

  load();

  window.novaMoney = money;
  window.NOVA_MONEY = { money: money, ready: ready };
})();