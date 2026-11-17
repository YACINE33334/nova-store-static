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
    // Generated product pages bake the current settings into NOVA_BOOT, so the
    // money formatter is ready immediately instead of blocking paint on an API call.
    var boot = (window.NOVA_BOOT && window.NOVA_BOOT.settings) || null;
    var bootCurrency = boot && boot.currency && CFG[boot.currency] ? boot.currency : '';
    if (bootCurrency) {
      current = CFG[bootCurrency];
      trigger();
    }

    fetch('/api/settings', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (s) {
        if (s && s.currency && CFG[s.currency] && s.currency !== bootCurrency) {
          current = CFG[s.currency];
          if (bootCurrency) window.dispatchEvent(new CustomEvent('nova:money'));
        }
      })
      .catch(function () { /* keep default USD */ })
      .then(function () { if (!bootCurrency) trigger(); });
  }

  load();

  window.novaMoney = money;
  window.NOVA_MONEY = { money: money, ready: ready };
})();