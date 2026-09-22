/* =========================================================
   NOVA — Supabase client module (static/static build)
   Wraps @supabase/supabase-js v2 with the publishable (anon)
   key ONLY — never any secret. Exposes window.NovaSupabase:
     .sb             the supabase client
     .refreshSession()  warms the (async) session cache
     .session()         cached session object or null
     .accessToken()     user token, else the anon key (guests)
     .authHeaders(ext)  { apikey, Authorization, ...extra }
     .isAuthed()        true when a user session exists
     .uploadBytes/.uploadDataUrl/.walkAndUpload/.publicUrl
   Loaded BEFORE api.js (the /api/* shim).
   ========================================================= */
(function () {
  'use strict';

  var SB_URL  = 'https://uoejjzfuhfogtkcnujih.supabase.co';
  var SB_ANON = 'sb_publishable_9BELNhWaEEKu3fWm6ZtrZw_Zz6gzY2x';
  var BUCKET  = 'product-images';
  var REST    = SB_URL + '/rest/v1';
  var STORAGE = SB_URL + '/storage/v1';

  var sb = window.supabase && window.supabase.createClient
    ? window.supabase.createClient(SB_URL, SB_ANON)
    : null;
  if (!sb && window.console) console.error('[nova-supabase.js] supabase-js UMD missing.');

  /* auth.getSession() is async in supabase-js v2 — keep a warm cache
     so the fetch shim can read the token synchronously after an await. */
  var _sess = null;

  function refreshSession() {
    if (!sb) return Promise.resolve(null);
    var g;
    try { g = sb.auth.getSession(); } catch (e) { g = null; }
    if (g && typeof g.then === 'function') {
      return g.then(function (r) {
        _sess = (r && r.data && r.data.session) || null;
        return _sess;
      }).catch(function () { _sess = null; return null; });
    }
    _sess = (g && g.data && g.data.session) || null;
    return Promise.resolve(_sess);
  }

  function session() { return _sess; }

  function accessToken() {
    return (_sess && _sess.access_token) ? _sess.access_token : SB_ANON;
  }

  function isAuthed() {
    return !!(_sess && _sess.user);
  }

  function authHeaders(extra) {
    var h = { apikey: SB_ANON, Authorization: 'Bearer ' + accessToken() };
    var k;
    for (k in (extra || {})) h[k] = extra[k];
    return h;
  }

  /* ---------------- storage ---------------- */
  var EXT = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg',
    'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg',
  };
  function newPath(ext) {
    return 'uploads/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + ext;
  }
  function publicUrl(path) {
    return STORAGE + '/object/public/' + BUCKET + '/' + path;
  }
  function errText(d, fallback) {
    if (d && d.message) {
      if (typeof d.message === 'string') return d.message;
      if (d.message.map) return d.message.map(function (x) { return x.message || ''; }).join(' · ');
    }
    if (d && d.error) return String(d.error);
    return fallback || 'error';
  }
  /* Uploads time out instead of spinning forever (e.g. storage policy
     rejects the insert for a non-admin session). */
  var UPLOAD_TIMEOUT_MS = 60000;
  function withTimeout() {
    var ctl = null, timer = null;
    if (window.AbortController) {
      ctl = new AbortController();
      timer = setTimeout(function () { ctl.abort(); }, UPLOAD_TIMEOUT_MS);
    }
    return {
      signal: ctl ? ctl.signal : null,
      clear: function () { if (timer) clearTimeout(timer); },
    };
  }
  function uploadBytes(body, contentType) {
    return refreshSession().then(function () {
      var path = newPath(EXT[contentType] || '');
      var t = withTimeout();
      var init = {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': contentType }),
        body: body,
      };
      if (t.signal) init.signal = t.signal;
      return fetch(STORAGE + '/object/' + BUCKET + '/' + path, init).then(function (r) {
        t.clear();
        if (r.status >= 200 && r.status < 300) return publicUrl(path);
        return r.json().then(function (d) {
          throw new Error(errText(d, 'Upload failed (' + r.status + ')'));
        });
      }).catch(function (e) {
        t.clear();
        if (e && e.name === 'AbortError') throw new Error('Upload timed out');
        throw e;
      });
    });
  }
  function storagePathFromUrl(url) {
    var m = /\/(?:object\/public\/)?product-images\/(.+)$/.exec(String(url || ''));
    return m ? m[1] : null;
  }
  function deleteObject(pathOrUrl) {
    var path = storagePathFromUrl(pathOrUrl) || pathOrUrl;
    if (!path) return Promise.resolve(false);
    return refreshSession().then(function () {
      return fetch(STORAGE + '/object/' + BUCKET + '/' + encodeURI(path), {
        method: 'DELETE',
        headers: authHeaders(),
      }).then(function (r) {
        return r.status >= 200 && r.status < 300;
      });
    }).catch(function () { return false; });
  }
  function uploadDataUrl(dataUrl) {
    var m = /^data:([^;,]+)/.exec(dataUrl);
    var ct = m ? m[1] : '';
    var i = dataUrl.indexOf(',');
    var b64 = (i >= 0 ? dataUrl.slice(i + 1) : dataUrl).replace(/\s/g, '');
    var body;
    try {
      var bin = atob(b64);
      body = new Uint8Array(bin.length);
      for (var j = 0; j < bin.length; j++) body[j] = bin.charCodeAt(j);
    } catch (e) {
      body = b64;
    }
    return uploadBytes(body, ct);
  }
  function walkAndUpload(obj) {
    var tasks = [];
    (function walk(o) {
      var k, v;
      if (!o || typeof o !== 'object') return;
      for (k in o) {
        v = o[k];
        if (typeof v === 'string' && v.indexOf('data:image/') === 0) {
          tasks.push(uploadDataUrl(v).then(function (url) { o[k] = url; }));
        } else if (v && typeof v === 'object') {
          walk(v);
        }
      }
    })(obj);
    return Promise.all(tasks).then(function () { return obj; });
  }

  window.NovaSupabase = {
    config: { SB_URL: SB_URL, SB_ANON: SB_ANON, BUCKET: BUCKET, REST: REST, STORAGE: STORAGE },
    sb: sb,
    refreshSession: refreshSession,
    session: session,
    accessToken: accessToken,
    authHeaders: authHeaders,
    isAuthed: isAuthed,
    uploadBytes: uploadBytes,
    uploadDataUrl: uploadDataUrl,
    walkAndUpload: walkAndUpload,
    publicUrl: publicUrl,
    storagePathFromUrl: storagePathFromUrl,
    deleteObject: deleteObject,
  };
})();