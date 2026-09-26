/* =========================================================
   NOVA — Meta (Facebook) Conversions API + Pixel loader.
   Reads from /api/settings (admin panel → الإعدادات → البكسل):
     fbPixelName  : pixel name (informational)
     fbPixel      : Pixel ID
     fbToken      : Conversions API access token
     fbTestCode   : Test Event Code (Events Manager → Test Events)
     currency     : store currency
   Behavior:
     • If Pixel ID is set → injects the official base code (browser
       Pixel) and fires PageView automatically.
     • If access token is set → also POSTs every tracked event to
       graph.facebook.com/{ver}/{pixelId}/events (Conversions API),
       deduplicated with the browser event via the same event_id.
     • If test code is set → sent as test_event_code in the CAPI
       payload so events appear under "Test Events" in Events Manager.
   Exposes window.NovaPixel.track(event, params) with an internal
   buffer so calls made before settings load are flushed afterwards.
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

  /* ---------- browser Pixel base code ---------- */
  function installPixel(pixelId) {
    var code = [
      "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?",
      "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;",
      "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;",
      "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}",
      "(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');",
      "fbq('init', '" + pixelId + "');"
    ].join('\n');
    var s = document.createElement('script');
    s.type = 'text/javascript';
    s.text = code;
    (document.head || document.documentElement).appendChild(s);
  }

  function sendFbq(event, params, eventId) {
    if (!window.fbq) { fbQueue.push({ event: event, params: params, eventId: eventId }); return; }
    try {
      window.fbq('track', event, params || {}, eventId ? { eventID: eventId } : {});
    } catch (e) { /* ignore */ }
  }

  /* ---------- Conversions API ---------- */
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
    var payload = {
      event_name: event,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: location.href,
      user_data: user,
      custom_data: custom,
    };
    return payload;
  }

  function sendCapi(event, params, eventId) {
    var token = String(settings.fbToken || '').trim();
    var pixel = digits(settings.fbPixel);
    if (!token || !pixel) return;
    var payload = { data: [capiPayload(event, params, eventId)] };
    if (String(settings.fbTestCode || '').trim() !== '') payload.test_event_code = String(settings.fbTestCode).trim();
    var url = 'https://graph.facebook.com/' + GRAPH_VER + '/' + pixel + '/events?access_token=' + encodeURIComponent(token);
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () { /* CAPI errors are non-blocking */ });
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
    get pixelId() { return digits(settings.fbPixel); },
    get currency() { return toCurrency(settings.currency); },
    get capiEnabled() { return !!(String(settings.fbToken || '').trim() && digits(settings.fbPixel)); },
    get testCode() { return String(settings.fbTestCode || '').trim(); },
    track: track,
  };

  fetch('/api/settings', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (s) {
      settings = s || {};
      var id = digits(settings.fbPixel);
      if (id && id.length >= 6) installPixel(id);
      ready = true;
      flush();
      track('PageView');
    })
    .catch(function () { /* no settings: pixel stays off */ });
})();