/* =========================================================
   NOVA — Supabase API shim (static-only architecture)
   Routes every legacy /api/* call straight to Supabase:
     /api/products => PostgREST products (id,data)
     /api/orders   => guest create/update via the SECURITY
                      DEFINER RPC guest_upsert_order (RLS locks
                      guests out of direct UPDATEs), reads via
                      the admin table
     /api/settings + /api/i18n => settings (key,value)
     /api/upload   => Storage bucket (fetch AND XHR)
     /api/auth/*   => Supabase Auth sessions
   Load BEFORE any app script (after nova-supabase.js, which is
   after the supabase-js UMD script) so window.fetch and
   window.XMLHttpRequest are already wrapped.
   ========================================================= */
(function () {
  'use strict';

  var NS = window.NovaSupabase;
  if (!NS || !NS.sb) {
    if (window.console) console.error('[api.js] NovaSupabase (nova-supabase.js) missing.');
    return;
  }
  var REST = NS.config.REST;
  var STORAGE = NS.config.STORAGE;
  var BUCKET = NS.config.BUCKET;

  /* ---------------- fetch-shaped response ---------------- */
  function mkResp(status, data, url) {
    return {
      ok: status >= 200 && status < 300,
      status: status,
      statusText: '',
      url: url || '',
      json: function () { return Promise.resolve(data); },
      text: function () {
        return Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data));
      },
      headers: { get: function () { return null; } },
      clone: function () { return this; },
    };
  }
  function errBody(d, fallback) {
    if (d && d.message) {
      if (typeof d.message === 'string') return d.message;
      if (d.message.map) return d.message.map(function (x) { return x.message || ''; }).join(' · ');
    }
    if (d && d.error) return String(d.error);
    return fallback || 'error';
  }
  var jr = function (r) { return r.json().catch(function () { return null; }); };

  /* ---------------- data shaping ---------------- */
  function flattenProduct(row) {
    var raw = row.data, d = raw || {}, k;
    if (raw && typeof raw === 'string') { try { d = JSON.parse(raw); } catch (e) { d = {}; } }
    var out = {};
    for (k in d) out[k] = d[k];
    out.id = row.id;
    if (out.createdAt == null) out.createdAt = row.created_at;
    if (out.updatedAt == null) out.updatedAt = row.updated_at;
    return out;
  }
  function flattenOrder(row) {
    var raw = row.data, d = raw || {}, k;
    if (raw && typeof raw === 'string') { try { d = JSON.parse(raw); } catch (e) { d = {}; } }
    var out = {};
    for (k in d) out[k] = d[k];
    out.id = row.id;
    out.sid = row.sid;
    out.status = row.status;
    out.productId = d.productId != null ? d.productId : row.product_id;
    out.qty = row.qty != null ? Number(row.qty) : (d.qty != null ? Number(d.qty) : 1);
    out.total = row.total != null ? Number(row.total) : (d.total != null ? Number(d.total) : 0);
    out.createdAt = row.created_at;
    out.updatedAt = row.updated_at;
    if (out.code == null && row.id != null) out.code = '#' + row.id;
    return out;
  }
  function rowData(row) {
    var d = {}, k;
    for (k in (row.data || {})) d[k] = row.data[k];
    return d;
  }
  function parseValue(text) {
    if (text == null) return '';
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  /* =========================================================
     /api/* router
     ========================================================= */
  function apiRequest(url, opts) {
    opts = opts || {};
    var u = new URL(url, location.href);
    var path = u.pathname;
    var method = (opts.method || 'GET').toUpperCase();
    var body = null;
    if (opts.body) {
      try { body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body; }
      catch (e) { body = null; }
    }
    var headers = function (extra) { return NS.authHeaders(extra); };
    var doFetch = function (q, o) { return fetch(REST + q, o); };

    /* ---- GET products / products?id=N (public read) ---- */
    if (path === '/api/products' && method === 'GET') {
      var id = u.searchParams.get('id');
      if (id) {
        return doFetch('/products?select=id,data&id=eq.' + encodeURIComponent(id), { headers: headers() }).then(function (r) {
          if (r.status !== 200) return r.json().then(function (d) { return mkResp(r.status, { error: errBody(d, 'HTTP ' + r.status) }, url); });
          return r.json().then(function (rows) {
            if (!rows || !rows.length) return mkResp(404, { error: 'Product not found' }, url);
            return mkResp(200, flattenProduct(rows[0]), url);
          });
        });
      }
      return doFetch('/products?select=id,data&order=id.asc', { headers: headers() }).then(function (r) {
        if (r.status !== 200) return r.json().then(function (d) { return mkResp(r.status, { error: errBody(d, 'HTTP ' + r.status) }, url); });
        return r.json().then(function (rows) {
          return mkResp(200, (rows || []).map(flattenProduct), url);
        });
      });
    }

    /* ---- POST products (create / update, admin) ---- */
    if (path === '/api/products' && method === 'POST') {
      return NS.refreshSession().then(function () {
        if (!NS.isAuthed()) return Promise.resolve(mkResp(401, { error: 'No autenticado' }, url));
        var p = body || {};
        var pid = p.id != null ? Number(p.id) : null;
        var remaining = {}, k;
        for (k in p) {
          if (k !== 'id' && k !== 'createdAt' && k !== 'updatedAt') remaining[k] = p[k];
        }
        return NS.walkAndUpload(remaining).then(function () {
          var req;
          if (pid != null) {
            req = doFetch('/products?on_conflict=id', {
              method: 'POST',
              headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }),
              body: JSON.stringify({ id: pid, data: remaining }),
            });
          } else {
            req = doFetch('/products?select=id,data', {
              method: 'POST',
              headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
              body: JSON.stringify({ data: remaining }),
            });
          }
          return req.then(function (r) {
            if (r.status >= 200 && r.status < 300) {
              return r.json().then(function (rows) {
                if (rows && rows.length) return mkResp(r.status === 201 ? 201 : 200, flattenProduct(rows[0]), url);
                return mkResp(200, remaining, url);
              });
            }
            return r.json().then(function (d) { return mkResp(r.status, { error: errBody(d, 'HTTP ' + r.status) }, url); });
          });
        });
      });
    }

    /* ---- DELETE products (admin) ---- */
    if (path === '/api/products' && method === 'DELETE') {
      return NS.refreshSession().then(function () {
        if (!NS.isAuthed()) return Promise.resolve(mkResp(401, { error: 'No autenticado' }, url));
        var did = u.searchParams.get('id');
        return doFetch('/products?id=eq.' + encodeURIComponent(did), { method: 'DELETE', headers: headers() }).then(function (r) {
          if (r.status >= 200 && r.status < 300) return mkResp(200, { ok: true }, url);
          return r.json().then(function (d) { return mkResp(r.status, { error: errBody(d, 'HTTP ' + r.status) }, url); });
        });
      });
    }

    /* ---- GET settings (public read) ---- */
    if (path === '/api/settings' && method === 'GET') {
      return doFetch('/settings?select=key,value', { headers: headers() }).then(jr).then(function (rows) {
        var out = {}, i;
        for (i = 0; rows && i < rows.length; i++) out[rows[i].key] = parseValue(rows[i].value);
        return mkResp(200, out, url);
      });
    }

    /* ---- POST settings (admin) ---- */
    if (path === '/api/settings' && method === 'POST') {
      return NS.refreshSession().then(function () {
        if (!NS.isAuthed()) return Promise.resolve(mkResp(401, { error: 'No autenticado' }, url));
        var s = body || {}, payload = [], k2;
        for (k2 in s) payload.push({ key: k2, value: JSON.stringify(s[k2] == null ? '' : s[k2]) });
        if (!payload.length) return Promise.resolve(mkResp(200, { ok: true }, url));
        return doFetch('/settings?on_conflict=key', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
          body: JSON.stringify(payload),
        }).then(function (r) {
          if (r.status >= 200 && r.status < 300) return mkResp(200, { ok: true }, url);
          return r.json().then(function (d) { return mkResp(r.status, { error: errBody(d, 'HTTP ' + r.status) }, url); });
        });
      });
    }

    /* ---- GET i18n (public read) ---- */
    if (path === '/api/i18n' && method === 'GET') {
      return doFetch('/settings?select=key,value&key=eq.checkoutI18n', { headers: headers() }).then(jr).then(function (rows) {
        var v = rows && rows.length ? parseValue(rows[0].value) : {};
        return mkResp(200, v && typeof v === 'object' ? v : {}, url);
      });
    }

    /* ---- POST i18n (admin; overrides stored as settings.checkoutI18n) ---- */
    if (path === '/api/i18n' && method === 'POST') {
      return NS.refreshSession().then(function () {
        if (!NS.isAuthed()) return Promise.resolve(mkResp(401, { error: 'No autenticado' }, url));
        var clean = {}, k3;
        for (k3 in (body || {})) {
          var v3 = String(body[k3] == null ? '' : body[k3]).trim();
          if (v3 !== '') clean[k3] = v3;
        }
        return doFetch('/settings?on_conflict=key', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' }),
          body: JSON.stringify([{ key: 'checkoutI18n', value: JSON.stringify(clean) }]),
        }).then(function (r) {
          if (r.status >= 200 && r.status < 300) return mkResp(200, { ok: true, count: Object.keys(clean).length }, url);
          return r.json().then(function (d) { return mkResp(r.status, { error: errBody(d, 'HTTP ' + r.status) }, url); });
        });
      });
    }

    /* ---- GET orders (admin; enriches productName from the catalog) ---- */
    if (path === '/api/orders' && method === 'GET') {
      return NS.refreshSession().then(function () {
        if (!NS.isAuthed()) return Promise.resolve(mkResp(401, { error: 'No autenticado' }, url));
        var ordersFetch = doFetch('/orders?select=id,sid,status,product_id,qty,total,created_at,updated_at,data&order=id.desc', { headers: headers() }).then(jr);
        var prodsFetch = doFetch('/products?select=id,data', { headers: headers() }).then(jr);
        return Promise.all([ordersFetch, prodsFetch]).then(function (res) {
          var rows = res[0] || [];
          var prows = res[1] || [];
          var names = {};
          for (var i = 0; i < prows.length; i++) {
            try { if (prows[i].data && prows[i].data.name) names[prows[i].id] = String(prows[i].data.name); } catch (e) { /* ignore */ }
          }
          return mkResp(200, rows.map(function (r) {
            var o = flattenOrder(r);
            if (!o.productName && names[o.productId]) o.productName = names[o.productId];
            return o;
          }), url);
        });
      });
    }

    /* ---- POST orders: guest draft upsert / final submit.
          Guests CANNOT UPDATE orders directly (RLS) — everything
          funnels through the SECURITY DEFINER RPC, keyed by their
          unguessable sid. Total is recomputed from the catalog
          price so the DB column stays correct even though the
          browser never sends a price. ---- */
    if (path === '/api/orders' && method === 'POST') {
      var o = body || {};
      var sid = String(o.sid || '').trim();
      var productId = Number(o.productId);
      var qty = Math.max(1, Math.min(99, Number(o.qty) || 1));
      var name = String(o.name || '').trim();
      var phone = String(o.phone || '').trim();
      var addr = String(o.location || '').trim();
      var isDraft = o.action === 'draft' || o.draft === true || o.draft === '1';

      if (!sid) return Promise.resolve(mkResp(400, { error: 'sid required' }, url));
      if (!isDraft && (!name || !phone || !addr)) {
        return Promise.resolve(mkResp(400, { error: 'name, phone and location are required' }, url));
      }

      var state = {};
      if (productId) {
        state.task = doFetch('/products?select=id,data&id=eq.' + productId, { headers: headers() }).then(jr).then(function (rows) {
          var p = rows && rows.length ? rows[0] : null;
          if (p && p.data) {
            try { state.productName = p.data.name || null; } catch (e) { state.productName = null; }
            try { state.price = Number(p.data.price) || null; } catch (e) { state.price = null; }
          } else {
            state.productName = o.productName || null;
            state.price = (o.price != null ? Number(o.price) : null);
          }
          return null;
        }).catch(function () {
          state.productName = o.productName || null;
          state.price = (o.price != null ? Number(o.price) : null);
          return null;
        });
      } else {
        state.productName = o.productName || null;
        state.price = (o.price != null ? Number(o.price) : null);
        state.task = Promise.resolve(null);
      }

      return state.task.then(function () {
        var total = (state.price != null) ? state.price * qty : 0;
        var payload = {
          productId: productId || null,
          productName: state.productName || null,
          price: state.price,
          name: name,
          phone: phone,
          location: addr,
          qty: qty,
          total: total,
        };
        ['address', 'piso', 'zip', 'city', 'province'].forEach(function (k) {
          payload[k] = String(o[k] == null ? '' : o[k]).trim();
        });
        if (Number.isFinite(Number(o.lat))) payload.lat = Number(o.lat);
        if (Number.isFinite(Number(o.lng))) payload.lng = Number(o.lng);

        return doFetch('/rpc/guest_upsert_order', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            sid_in: sid,
            status_in: isDraft ? 'draft' : 'pending',
            qty_in: qty,
            total_in: total,
            payload: payload,
          }),
        }).then(function (r) {
          return r.json().then(function (d) {
            if (r.status >= 200 && r.status < 300 && d && d.id != null) {
              var oid = Number(d.id);
              var out = {
                id: oid,
                code: '#' + oid,
                status: isDraft ? 'draft' : 'pending',
                sid: sid,
                qty: qty,
                total: total,
              };
              var k;
              for (k in payload) { if (out[k] === undefined) out[k] = payload[k]; }
              return mkResp(200, out, url);
            }
            return mkResp(r.status >= 400 ? r.status : 400, { error: errBody(d, 'Order not saved') }, url);
          });
        }).catch(function (e) {
          return mkResp(502, { error: e && e.message ? e.message : 'Order not saved' }, url);
        });
      });
    }

    /* ---- PUT orders (admin spreadsheet save) ---- */
    if (path === '/api/orders' && method === 'PUT') {
      return NS.refreshSession().then(function () {
        if (!NS.isAuthed()) return Promise.resolve(mkResp(401, { error: 'No autenticado' }, url));
        var all = Array.isArray(body) ? body : (body && body.updates);
        if (!Array.isArray(all)) return Promise.resolve(mkResp(400, { error: 'Expected an array of order updates' }, url));
        var ALLOWED = ['name', 'phone', 'address', 'piso', 'city', 'zip', 'province', 'status'];
        var tasks = [];
        var changed = 0;
        all.forEach(function (u) {
          if (!u || u.id == null) return;
          var tid = Number(u.id);
          var patch = u.patch || u;
          var np = {};
          ALLOWED.forEach(function (k) {
            if (patch[k] !== undefined) np[k] = String(patch[k] == null ? '' : patch[k]).trim();
          });
          if (!Object.keys(np).length) return;
          tasks.push(
            doFetch('/orders?select=id,status,data&id=eq.' + tid, { headers: headers() }).then(jr).then(function (rows) {
              if (!rows || !rows.length) return Promise.resolve();
              var row = rows[0];
              var d = rowData(row);
              Object.keys(np).forEach(function (k) {
                if (k === 'status') return;
                d[k] = np[k];
              });
              d.updatedAt = new Date().toISOString();
              return doFetch('/orders?id=eq.' + tid, {
                method: 'PATCH',
                headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
                body: JSON.stringify({ status: np.status || row.status, data: d, updated_at: new Date().toISOString() }),
              }).then(function (r) {
                if (r.status >= 200 && r.status < 300) changed++;
              });
            })
          );
        });
        return Promise.all(tasks).then(function () {
          return mkResp(200, { ok: true, changed: changed }, url);
        });
      });
    }

    /* ---- auth ---- */
    if (path === '/api/auth/me' && method === 'GET') {
      return NS.refreshSession().then(function () {
        var ses = NS.session();
        if (!ses) return mkResp(401, { error: 'No autenticado' }, url);
        var email = ses.user && (ses.user.email || '');
        return mkResp(200, { code: email, name: '' }, url);
      });
    }
    if (path === '/api/auth/status' && method === 'GET') {
      return NS.refreshSession().then(function () {
        return mkResp(200, { setup: false, loggedIn: !!NS.session() }, url);
      });
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      return NS.refreshSession().then(function () {
        if (NS.sb) NS.sb.auth.signOut();
        return mkResp(200, { ok: true }, url);
      });
    }
    if ((path === '/api/auth/login' || path === '/api/auth/setup') && method === 'POST') {
      return NS.refreshSession().then(function () {
        var email = String((body && body.email) || '').toLowerCase().trim();
        var password = String((body && body.password) || '');
        if (!email || !password) return Promise.resolve(mkResp(400, { error: 'Email y contraseña son obligatorios' }, url));
        var action;
        if (path === '/api/auth/setup') {
          action = Promise.resolve()
            .then(function () { return NS.sb.auth.signUp({ email: email, password: password }); })
            .then(function (r) {
              if (r.error) throw r.error;
              if (r.data && r.data.session) return r;
              return NS.sb.auth.signInWithPassword({ email: email, password: password });
            });
        } else {
          action = NS.sb.auth.signInWithPassword({ email: email, password: password });
        }
        return action.then(function (r) {
          if (r.error) {
            var msg = String(r.error.message || 'Error de autenticación');
            var stat = /already|existente|registered/i.test(msg) ? 409 : (/invalid|incorrecto|credenciales/i.test(msg) ? 401 : 401);
            return mkResp(stat, { error: msg }, url);
          }
          return NS.refreshSession().then(function () {
            return mkResp(200, { ok: true, code: email }, url);
          });
        }).catch(function (e) {
          NS.refreshSession();
          return mkResp(401, { error: e && e.message ? e.message : 'Error de autenticación' }, url);
        });
      });
    }

    /* ---- upload (admin; raw body via XHR or fetch) ---- */
    if (path === '/api/upload' && method === 'POST') {
      if (!opts.body) return Promise.resolve(mkResp(400, { error: 'Empty body' }, url));
      return NS.uploadBytes(opts.body, (opts.contentType || 'application/octet-stream')).then(function (u) {
        return mkResp(201, { url: u, size: opts.body.size || opts.body.byteLength || 0, type: opts.contentType || '' }, url);
      }).catch(function (e) {
        return mkResp(413, { error: e && e.message ? e.message : 'Upload failed' }, url);
      });
    }

    return Promise.resolve(mkResp(404, { error: 'Not found in api.js shim' }, url));
  }

  /* =========================================================
     Wrap window.fetch for /api/* calls
     (Supabase REST/storage calls use the original fetch.)
     ========================================================= */
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    var wrappedFetch = nativeFetch;
    window.fetch = function (input, init) {
      var u = String(input && input.url ? input.url : input);
      if (u.indexOf('/api/') === 0) return apiRequest(u, init);
      return wrappedFetch(input, init);
    };
  }

  /* =========================================================
     Wrap XMLHttpRequest so editor uploads (/api/upload) work
     ========================================================= */
  var NativeXHR = window.XMLHttpRequest;
  if (NativeXHR) {
    function NovaXHR() {
      var self = this;
      var url = '', m = '', useShim = false, native = null;
      var headerMap = {};
      var _status = 0, _responseText = '';

      this.open = function (mm, uu) {
        m = mm; url = String(uu || '');
        useShim = url.indexOf('/api/upload') === 0;
        if (!useShim) {
          native = new NativeXHR();
          ['onload', 'onerror', 'onprogress', 'onabort', 'onreadystatechange', 'ontimeout'].forEach(function (ev) {
            native[ev] = function () {
              if (self[ev]) self[ev].apply(self, arguments);
            };
          });
          native.open(m, url, true);
        }
      };
      this.setRequestHeader = function (k, v) {
        if (useShim) headerMap[k] = v;
        else if (native) native.setRequestHeader(k, v);
      };
      this.send = function (data) {
        if (!useShim) { native.send(data); return; }
        var ct = headerMap['Content-Type'] || 'application/octet-stream';
        NS.uploadBytes(data, ct).then(function (u) {
          _status = 201;
          _responseText = JSON.stringify({ url: u, size: (data && data.size) || (data && data.byteLength) || 0, type: ct });
          if (self.onload) self.onload.call(self);
        }).catch(function (e) {
          _status = 500;
          _responseText = JSON.stringify({ error: e && e.message ? e.message : 'Upload failed' });
          if (self.onload) self.onload.call(self);
        });
      };
      this.abort = function () { if (native) native.abort(); };
      Object.defineProperty(this, 'status', { get: function () { return native ? native.status : _status; } });
      Object.defineProperty(this, 'responseText', { get: function () { return native ? native.responseText : _responseText; } });
      Object.defineProperty(this, 'readyState', { get: function () { return native ? native.readyState : 4; } });
    }
    NovaXHR.prototype = NativeXHR.prototype;
    window.XMLHttpRequest = NovaXHR;
  }

  window.NovaApi = {
    isAuthed: NS.isAuthed,
    accessToken: NS.accessToken,
  };
})();