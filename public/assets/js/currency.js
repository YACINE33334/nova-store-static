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
  var currentCode = 'USD';
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

  // Settings values are JSON-encoded in Supabase; older generated pages may
  // still carry the quoted form ("EUR"), so strip wrapping quotes defensively.
  function normCode(code) {
    return String(code == null ? '' : code).trim().replace(/^["']|["']$/g, '').toUpperCase();
  }

  function setCurrency(code) {
    var c = normCode(code);
    if (!CFG[c] || c === currentCode) return;
    currentCode = c;
    current = CFG[c];
    if (done) window.dispatchEvent(new CustomEvent('nova:money'));
  }

  function load() {
    // Generated product pages bake the current settings into NOVA_BOOT, so the
    // money formatter is ready immediately instead of blocking paint on an API
    // call. A later tiny REST refresh can update it via NOVA_MONEY.setCurrency().
    var boot = (window.NOVA_BOOT && window.NOVA_BOOT.settings) || null;
    var bootCurrency = boot && CFG[normCode(boot.currency)] ? normCode(boot.currency) : '';
    if (bootCurrency) {
      currentCode = bootCurrency;
      current = CFG[bootCurrency];
      trigger();
      return;
    }

    // A visitor coming from a product page already has the store currency in
    // sessionStorage, so the checkout can paint in EUR without waiting for
    // /api/settings. The request below still corrects it in the background.
    var cached = '';
    try { cached = sessionStorage.getItem('nova_checkout_currency') || ''; } catch (e) { /* private mode */ }
    var cachedCurrency = CFG[normCode(cached)] ? normCode(cached) : '';
    var initial = cachedCurrency;
    if (cachedCurrency) {
      currentCode = cachedCurrency;
      current = CFG[cachedCurrency];
      trigger();
    }

    function trySettings() {
      return fetch('/api/settings', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (s) { if (s) setCurrency(s.currency); })
        .catch(function () { /* shim may still be loading */ });
    }

    // On the checkout the API shim is injected after first paint, so wait for
    // it instead of firing a 404 against the static host.
    var settingsReady = window.novaApiReady
      ? window.novaApiReady.then(trySettings).catch(function () {})
      : trySettings();
    settingsReady.then(function () { if (!initial) trigger(); });
  }

  load();

  window.novaMoney = money;
  window.NOVA_MONEY = {
    money: money,
    get code() { return currentCode; },
    ready: ready,
    setCurrency: setCurrency,
  };
})();