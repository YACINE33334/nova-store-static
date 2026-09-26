/* =========================================================
   NOVA — Meta (Facebook) Pixel loader.
   Reads the pixel ID + currency from /api/settings
   (saved in the admin panel → الإعدادات → البكسل).
   Injects the official base code with the pixel ID and
   exposes window.NovaPixel.track(...) so pages can fire
   standard events (PageView, ViewContent, AddToCart,
   InitiateCheckout, Purchase) with correct value+currency.
   ========================================================= */
(function () {
  'use strict';

  var settings = { currency: 'USD' };
  var ready = false;
  var queue = [];

  function digits(id) {
    return String(id || '').trim().replace(/\D/g, '');
  }

  function toCurrency(code) {
    code = String(code || '').trim().toUpperCase();
    return (code === 'EUR' || code === 'KWD' || code === 'USD') ? code : 'USD';
  }

  function flush() {
    if (!ready) return;
    var ev;
    while (queue.length) {
      ev = queue.shift();
      try { window.fbq('track', ev.name, ev.params || {}); } catch (e) { /* ignore */ }
    }
  }

  function install(pixelId) {
    var code = [
      "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?",
      "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;",
      "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;",
      "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}",
      "(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');",
      "fbq('init', '" + pixelId + "');",
      "fbq('track', 'PageView');"
    ].join('\n');
    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.text = code;
    document.head.appendChild(s);
    ready = true;
    flush();
  }

  window.NovaPixel = {
    get ready() { return ready; },
    get pixelId() { return digits(settings.fbPixel); },
    get currency() { return toCurrency(settings.currency); },
    track: function (name, params) {
      if (ready) {
        try { window.fbq('track', name, params || {}); } catch (e) { /* ignore */ }
      } else {
        queue.push({ name: name, params: params || {} });
      }
      return this;
    }
  };

  fetch('/api/settings', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      settings = s || {};
      var id = digits(settings.fbPixel);
      if (id && id.length >= 6) install(id);
    })
    .catch(function () { /* no settings: pixel stays off */ });
})();