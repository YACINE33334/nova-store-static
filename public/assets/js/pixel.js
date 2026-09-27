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
     • CAPI user_data carries client_ip_address (best effort via
       a public IP echo), client_user_agent, fbp/fbc and — once
       setCustomer() is called (checkout form) — SHA-256 hashed
       phone/name/city/zip so Meta never rejects the event with
       error 2804050 ("insufficient customer information").
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
  var customer = {};
  var clientIp = '';
  var clientIpPromise = null;

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

  /* SHA-256 hash (hex), used to obfuscate customer PII for Meta. */
  function sha256(text) {
    if (!text) return Promise.resolve('');
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) {
      return Promise.resolve('');
    }
    try {
      return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
        var b = new Uint8Array(buf), hex = [], i;
        for (i = 0; i < b.length; i++) hex.push((b[i] >>> 4).toString(16), (b[i] & 0xf).toString(16));
        return hex.join('');
      });
    } catch (e) { return Promise.resolve(''); }
  }

  /* Client public IP, fetched once and cached (best effort). */
  function getClientIp() {
    if (clientIp) return Promise.resolve(clientIp);
    if (!clientIpPromise) {
      clientIpPromise = fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          clientIp = String((j && j.ip) || '').trim();
          return clientIp;
        })
        .catch(function () { clientIp = ''; return ''; });
    }
    return clientIpPromise;
  }

  function withTimeout(p, ms) {
    var p2 = new Promise(function (resolve) { setTimeout(function () { resolve(''); }, ms); });
    return Promise.race([p, p2]);
  }

  /* Remember raw customer fields from the checkout form.
     They are hashed into user_data for CAPI at send time. */
  function setCustomer(c) {
    c = c || {};
    customer = {
      phone: String(c.phone || '').replace(/\D/g, ''),
      name: String(c.name || '').trim(),
      city: String(c.city || '').trim(),
      zip: String(c.zip || '').trim(),
      province: String(c.province || '').trim(),
    };
  }

  function hashCustomer() {
    var tasks = [];
    var out = {};
    function add(key, val) {
      if (!val) return;
      tasks.push(sha256(val).then(function (h) { if (h) out[key] = h; }));
    }
    add('ph', customer.phone);
    if (customer.name) {
      var parts = customer.name.split(/\s+/);
      add('fn', parts[0]);
      if (parts.length > 1) add('ln', parts.slice(1).join(' '));
    }
    add('ct', customer.city);
    add('zp', customer.zip);
    add('st', customer.province);
    return Promise.all(tasks).then(function () { return out; });
  }

  /* normalize settings into an array of pixel configs (deduped) */
  function pixelList() {
    var list;
    if (Array.isArray(settings.fbPixels) && settings.fbPixels.length) {
      list = settings.fbPixels.map(function (p) {
        return {
          name: String(p.name || '').trim(),
          pixel: digits(p.pixel),
          token: String(p.token || '').trim(),
          testCode: String(p.testCode || '').trim(),
        };
      }).filter(function (p) { return p.pixel && p.pixel.length >= 6; });
    } else {
      var legacy = digits(settings.fbPixel);
      if (legacy.length >= 6) {
        list = [{
          name: String(settings.fbPixelName || '').trim(),
          pixel: legacy,
          token: String(settings.fbToken || '').trim(),
          testCode: String(settings.fbTestCode || '').trim(),
        }];
      } else {
        return [];
      }
    }
    var seen = {}, out = [];
    list.forEach(function (p) {
      if (seen[p.pixel]) return; /* dedupe duplicate pixel IDs */
      seen[p.pixel] = true;
      out.push(p);
    });
    return out;
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
  function capiPayload(event, params, eventId, user) {
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
    Promise.all([withTimeout(getClientIp(), 1500), hashCustomer()])
      .catch(function () { return ['', {}]; })
      .then(function (res) {
        var ip = res[0] || '';
        var hashed = res[1] || {};
        var user = {
          client_ip_address: ip,
          client_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          fbp: readCookie('_fbp'),
        };
        var fbc = readCookie('_fbc');
        if (fbc) user.fbc = fbc;
        var k;
        for (k in hashed) user[k] = hashed[k];
        pixelList().forEach(function (p) {
          if (!p.token) return;
          var payload = { data: [capiPayload(event, params, eventId, user)] };
          if (p.testCode !== '') payload.test_event_code = p.testCode;
          var url = 'https://graph.facebook.com/' + GRAPH_VER + '/' + p.pixel + '/events?access_token=' + encodeURIComponent(p.token);
          fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(function () { /* CAPI errors are non-blocking */ });
        });
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
    setCustomer: setCustomer,
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
    .catch(function () {
      ready = true;
      flush();
    });
})();