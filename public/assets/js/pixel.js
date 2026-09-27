/* =========================================================
   NOVA — Meta (Facebook) Conversions API + Pixel loader.
   Supports MULTIPLE pixels. Reads from /api/settings
   (admin panel → الإعدادات → البكسل):

     fbPixels: [ { name, pixel, token, testCode }, ... ]
     fbPixel / fbToken / ... → legacy single-pixel keys

   Behavior:
     • Each pixel ID is initialized in the browser Pixel base
       code (fbq('init', id) for every configured pixel).
     • Each pixel that has an access token also receives its
       own Conversions API POST to
       graph.facebook.com/{ver}/{pixelId}/events, using its own
       token and its own test_event_code.
     • Browser Pixel and CAPI share the same event_id per event
       for deduplication.
   Exposes window.NovaPixel.track(event, params) with an internal
   buffer so calls made before settings load are flushed later.
   ========================================================= */
(function () {
  'use strict';

  var GRAPH_VER = 'v25.0';

  var settings = { currency: 'USD' };
  var ready = false;
  var queue = [];
  var fbQueue = [];

  function digits(id) {
    return String(id || '').trim().replace(/\D/g, '');
  }

  function toCurrency(code) {
    code = String(code || '').trim().toUpperCase();
    return (code === 'EUR' || code === 'KWD' || code === 'USD') ? code : 'USD';
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
  }

  function readCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  /* normalize settings into an array of pixel configs */
  function pixelList() {
    if (Array.isArray(settings.fbPixels) && settings.fbPixels.length) {
      return settings.fbPixels.map(function (p) {
        return {
          name: String(p.name || '').trim(),
          pixel: digits(p.pixel),
          token: String(p.token || '').trim(),
          testCode: String(p.testCode || '').trim(),
        };
      }).filter(function (p) { return p.pixel; });
    }
    var legacy = digits(settings.fbPixel);
    if (legacy.length >= 6) {
      return [{
        name: String(settings.fbPixelName || '').trim(),
        pixel: legacy,
        token: String(settings.fbToken || '').trim(),
        testCode: String(settings.fbTestCode || '').trim(),
      }];
    }
    return [];
  }

  /* ---------- browser Pixel base code ---------- */
  function installPixel(list) {
    var lines = [
      "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?",
      "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;",
      "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;",
      "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}",
      "(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');"
    ];
    list.forEach(function (p) {
      lines.push("fbq('init', '" + p.pixel + "');");
    });
    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.text = lines.join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function sendFbq(event, params, eventId) {
    if (!window.fbq) { fbQueue.push({ event: event, params: params, eventId: eventId }); return; }
    try {
      window.fbq('track', event, params || {}, eventId ? { eventID: eventId } : {});
    } catch (e) { /* ignore */ }
  }

  /* ---------- Conversions API (one POST per pixel with a token) ---------- */
  function capiPayload(event, params, eventId) {
    var ea = (params && params.contents) ? params.contents : [];
    if (params && !ea.length && params.content_ids && params.content_ids.length) {
      ea = params.content_ids.map(function (cid) {
        return { id: cid, quantity: params.num_items || 1, item_price: Number(params.value) || 0 };
      });
    }
    var custom = {
      content_name: (params && params.content_name) || null,
      content_type: (params && params.content_type) || 'product',
      content_ids: (params && params.content_ids) || [],
      contents: ea,
      value: Number((params && params.value) || 0),
      currency: toCurrency((params && params.currency) || settings.currency),
      num_items: Number((params && params.num_items) || 0),
    };
    var user = {
      client_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      fbp: readCookie('_fbp'),
    };
    var fbc = readCookie('_fbc');
    if (fbc) user.fbc = fbc;
    return {
      event_name: event,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: location.href,
      user_data: user,
      custom_data: custom,
    };
  }

  function sendCapi(event, params, eventId) {
    pixelList().forEach(function (p) {
      if (!p.token) return;
      var payload = { data: [capiPayload(event, params, eventId)] };
      if (p.testCode !== '') payload.test_event_code = p.testCode;
      var url = 'https://graph.facebook.com/' + GRAPH_VER + '/' + p.pixel + '/events?access_token=' + encodeURIComponent(p.token);
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function () { /* CAPI errors are non-blocking */ });
    });
  }

  /* ---------- public API ---------- */
  function track(event, params) {
    var eventId = uid();
    if (ready) {
      try { sendFbq(event, params, eventId); } catch (e) { /* ignore */ }
      sendCapi(event, params, eventId);
    } else {
      queue.push({ event: event, params: params, eventId: eventId });
    }
    return this;
  }

  function flush() {
    if (!ready) return;
    var q;
    while (queue.length) {
      q = queue.shift();
      try { sendFbq(q.event, q.params, q.eventId); } catch (e) { /* ignore */ }
      sendCapi(q.event, q.params, q.eventId);
    }
    var fb;
    while (fbQueue.length) {
      fb = fbQueue.shift();
      try { window.fbq('track', fb.event, fb.params || {}, fb.eventId ? { eventID: fb.eventId } : {}); } catch (e) { /* ignore */ }
    }
  }

  window.NovaPixel = {
    get ready() { return ready; },
    get pixels() { return pixelList(); },
    get currency() { return toCurrency(settings.currency); },
    get capiEnabled() { return pixelList().some(function (p) { return !!p.token; }); },
    track: track,
  };

  fetch('/api/settings', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      settings = s || {};
      var list = pixelList();
      if (list.length) installPixel(list);
      ready = true;
      flush();
      track('PageView');
    })
    .catch(function () { /* no settings: pixel stays off */ });
})();