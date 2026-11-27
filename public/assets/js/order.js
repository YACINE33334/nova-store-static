/* =========================================================
   NOVA — Checkout para el mercado español (pago contra
   reembolso).

   Flujo:
     1. Nombre completo
     2. Teléfono
     3. Dirección: calle y número → ciudad + provincia
        (lista de provincias) + código postal
     4. Total a pagar contra reembolso + "Realizar pedido"
   ========================================================= */
(function () {
  'use strict';

  const CURRENCY = '$';

  /* Google Sheet logger (Apps Script web app). Nada se envía salvo que el
     administrador active el modo "venta" en Ajustes → Registro de pedidos. */
  const SHEET_WEBHOOK = 'https://script.google.com/macros/s/AKfycbyqGbhfGfCHLMSyM_9TWL0yb2WV83ogIaFblm5gl8gnN1-cEjKls7YKQpCZ_5-NSFUs/exec';

  async function logOrderToSheet(order, product) {
    try {
      if (!SHEET_WEBHOOK || SHEET_WEBHOOK.indexOf('__DEPLOYMENT_ID__') >= 0) return;
      const cfg = await fetchJson('/api/settings');
      if (!cfg.ok || !cfg.data || cfg.data.sheetLogMode !== 'live') return;
      let utm = '';
      try {
        utm = new URLSearchParams(location.search).get('utm_source')
          || sessionStorage.getItem('nova_utm_source') || '';
      } catch (e) { /* best effort */ }
      const body = {
        key: 'nova_a32f803b06847dd2ff8f9713',
        orderId: order.id,
        sid: order.sid || '',
        customer: order.name || '',
        phone: order.phone || '',
        address: [order.address, order.piso].filter(Boolean).join(' ').trim(),
        city: order.city || '',
        zip: order.zip || '',
        province: order.province || '',
        country: 'Spain',
        sku: String((product && product.sku) || (order && order.sku) || (product && product.id) || order.productId || ''),
        qty: Number(order.qty) || 1,
        total: Number(order.total) || 0,
        utmSource: utm,
        prepaid: (cfg.data.sheetPrepaid != null ? String(cfg.data.sheetPrepaid) : '') || order.prepaid || '',
        note: String((product && (product.sheetNote || product.note)) || order.note || ''),
      };
      await fetch(SHEET_WEBHOOK, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch (e) { /* never break the checkout */ }
  }

  /* ---------------- traducciones del formulario ---------------- */
  const DEFAULTS = (window.NOVA_I18N_DEFAULTS) || {};
  let OVERRIDES = {};
  function t(key, vars) {
    let v = (OVERRIDES[key] != null && String(OVERRIDES[key]).trim() !== '')
      ? OVERRIDES[key]
      : (DEFAULTS[key] != null ? DEFAULTS[key] : key);
    v = String(v);
    if (vars) {
      Object.keys(vars).forEach((k) => { v = v.split('{' + k + '}').join(String(vars[k])); });
    }
    return v;
  }

  function currency(n) {
    return window.novaMoney ? window.novaMoney(n) : CURRENCY + (Number(n) || 0).toLocaleString('en-US');
  }

  const productIcon = (hue, size) => `
    <svg width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <g fill="none" stroke="rgba(11,11,13,.28)" stroke-width="1.5">
        <rect x="18" y="34" width="84" height="70" rx="8"/>
        <circle cx="60" cy="64" r="16"/>
        <path d="M18 76 L46 56 L74 74 L102 58"/>
      </g>
    </svg>`;

  const $ = (sel, scope) => (scope || document).querySelector(sel);

  /* ---------------- lista de provincias / regiones ---------------- */
  const PROVINCIAS = [
    'A Coruña', 'Álaba', 'Albacete', 'Alicante', 'Almería',
    'Andalusia', 'Aragon', 'Asturias', 'Ávila', 'Badajoz',
    'Balears', 'Barcelona', 'Basque Country', 'Bizkaia', 'Burgos',
    'Cáceres', 'Cádiz', 'Cantabria', 'Castellón', 'Castille-La Mancha',
    'Castille-Leon', 'Catalonia', 'Ciudad Real', 'Córdoba', 'Cuenca',
    'Extremadura', 'Galicia', 'Girona', 'Granada', 'Guadalajara',
    'Guipúzcoa', 'Huelva', 'Huesca', 'Jaén', 'La Rioja',
    'Leon', 'Lleida', 'Lugo', 'Madrid', 'Malaga',
    'Marbella', 'Murcia', 'Navarra', 'Navarre', 'Ourense',
    'Palencia', 'Palma', 'Pontevedra', 'Salamanca', 'Santander',
    'Segovia', 'Sevilla', 'Soria', 'Tarragona', 'Teruel',
    'Toledo', 'Valencia', 'Valladolid', 'Vitoria-Gasteiz', 'Vizcaya',
    'Zamora', 'Zaragoza',
  ];

  function provinceOptions() {
    return PROVINCIAS.map((p) => `<option value="${p}">${p}</option>`).join('');
  }

  function normalizeProvince(v) {
    return String(v || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/^(comunidad foral de |comunidad de |comunitat de |principado de |region de )/, '')
      .trim();
  }

  function matchProvince(v) {
    const n = normalizeProvince(v);
    if (!n) return '';
    for (const p of PROVINCIAS) if (normalizeProvince(p) === n) return p;
    return '';
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, Object.assign({ cache: 'no-store' }, opts));
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  /* ---------------- errores ---------------- */

  function showError(msg) {
    const el = $('#order-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
  }

  /* ---------------- ciudad automática desde código postal ---------------- */

  let zipTimer = null;

  function bindZipCity() {
    const zipInput = $('#cf-zip');
    const cityInput = $('#cf-city');
    const provInput = $('#cf-province');
    if (!zipInput || !cityInput) return;

    cityInput.addEventListener('input', () => { cityInput.dataset.autofilled = '0'; });

    zipInput.addEventListener('input', () => {
      clearTimeout(zipTimer);
      const zip = zipInput.value.trim();
      if (!/^\d{5}$/.test(zip)) return;
      zipTimer = setTimeout(async () => {
        try {
          const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=es&accept-language=es&postalcode='
            + zip;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          const j = await res.json();
          if (!j || !j.length) return;
          const addr = j[0].address || {};
          const city = addr.city || addr.town || addr.village || addr.city_district || addr.quarter || '';
          const prov = addr.state || addr.province || addr.region || '';
          if (city && cityInput.dataset.autofilled !== '0') {
            cityInput.value = city;
            cityInput.dataset.autofilled = '1';
          }
          if (provInput && prov) {
            if (provInput.tagName === 'SELECT') {
              const match = matchProvince(prov);
              if (match) provInput.value = match;
            } else {
              provInput.value = prov;
            }
          }
        } catch (e) { /* sin internet: el cliente escribe la ciudad */ }
      }, 450);
    });
  }

  /* ---------------- formulario ---------------- */

  function buildLocationString() {
    const street = $('#cf-street').value.trim();
    const zip = $('#cf-zip').value.trim();
    const city = $('#cf-city').value.trim();
    const prov = $('#cf-province').value.trim();
    const parts = [street, [zip, city].filter(Boolean).join(' '), prov].filter(Boolean);
    return parts.join(', ');
  }

/* ---------------- borrador de pedido (checkout autosave) ---------------- */

  function leadSid() {
    try {
      let sid = localStorage.getItem('nova_checkout_sid');
      if (!sid) {
        sid = 'sid-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2, 10));
        localStorage.setItem('nova_checkout_sid', sid);
      }
      return sid;
    } catch (e) { return 'sid-' + Date.now(); }
  }

  function collectLead(product, qty) {
    const v = (id) => {
      const el = $(id);
      return el ? el.value.trim() : '';
    };
    const name = v('#o-name');
    const phone = v('#o-phone');
    const street = v('#cf-street');
    const zip = v('#cf-zip');
    const city = v('#cf-city');
    const prov = v('#cf-province');
    if (!name && !phone && !street && !zip && !city && !prov) return null;
    const body = {
      action: 'draft',
      sid: leadSid(),
      productId: product.id,
      qty: qty,
      name, phone, address: street, city, zip, province: prov,
    };
    return body;
  }

  function bindLeadCapture(product, qty) {
    let timer = null;
    const post = (body) => {
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    };
    const send = (immediate) => {
      clearTimeout(timer);
      const body = collectLead(product, qty);
      if (!body) return;
      if (immediate) post(body);
      else timer = setTimeout(() => post(body), 400);
    };
    const fields = ['#o-name', '#o-phone', '#cf-city', '#cf-street', '#cf-province', '#cf-zip'];
    fields.forEach((sel) => {
      const el = $(sel);
      if (el) {
        el.addEventListener('input', () => send(false));
        el.addEventListener('change', () => send(true));
        el.addEventListener('blur', () => send(true));
      }
    });
    const flush = () => send(true);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  function renderCheckout(product, qty) {
    const total = Number(product.price) * qty;
    const pimg = Array.isArray(product.images) && product.images[0] ? product.images[0] : null;
    const thumb = pimg
      ? `<img class="ck-img" src="${pimg}" alt="${product.name}">`
      : productIcon(product.hue || '#f5f5f5', 46);

    $('#order-root').innerHTML = `
      <div class="checkout">
        <div class="ck-cod">
          <div class="ck-cod-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 6v6c0 5 3.8 8.4 9 10 5.2-1.6 9-5 9-10V6l-9-4Z"/><path d="M9 12.5l2 2 4-4.5"/></svg>
          </div>
          <div class="ck-cod-txt">
            <strong>${t('ck_cod_title')}</strong>
            <span>${t('ck_cod_sub')}</span>
          </div>
        </div>

        <div class="ck-prod">
          <div class="ck-thumb" style="background:${product.hue || '#f5f5f5'}">${thumb}</div>
          <div class="ck-prod-info">
            <div class="ck-prod-name">${product.name}</div>
            <div class="ck-prod-cat">${product.cat || t('ck_prod_label')} &middot; x${qty}</div>
          </div>
          <div class="ck-prod-price">${currency(total)}</div>
        </div>

        <form class="order-form" id="order-form" novalidate>
          <h2 class="ck-title">${t('fields_head')}</h2>
          <p class="ck-sub">${t('fields_sub')}</p>

          <div class="ck-field">
            <input type="text" id="o-name" name="name" placeholder="${t('name_ph')}" autocomplete="name" required />
            <label for="o-name">${t('name_label')} <span>*</span></label>
          </div>

          <div class="ck-field">
            <input type="tel" id="o-phone" name="phone" placeholder="${t('phone_ph')}" autocomplete="tel" required />
            <label for="o-phone">${t('phone_label')} <span>*</span></label>
          </div>

          <div class="ck-field">
            <input type="text" id="cf-street" name="address" placeholder="${t('street_ph')}" autocomplete="street-address" required />
            <label for="cf-street">${t('street_label')} <span>*</span></label>
          </div>

          <div class="ck-row3">
            <div class="ck-field">
              <input type="text" id="cf-city" name="city" placeholder="${t('city_ph')}" autocomplete="address-level2" required />
              <label for="cf-city">${t('city_label')} <span>*</span></label>
            </div>
            <div class="ck-field">
              <select id="cf-province" name="province" autocomplete="address-level1">
                <option value="">${t('prov_select')}</option>
                ${provinceOptions()}
              </select>
              <label for="cf-province">${t('prov_label')}</label>
            </div>
            <div class="ck-field">
              <input type="text" id="cf-zip" name="zip" inputmode="numeric" placeholder="${t('zip_ph')}" autocomplete="postal-code" maxlength="5" required />
              <label for="cf-zip">${t('zip_label')} <span>*</span></label>
            </div>
          </div>

          <div class="ck-pay">
            <div class="ck-total">
              <span>${t('pay_label')}</span>
              <strong>${currency(total)}</strong>
            </div>
            <button type="submit" class="ck-submit" id="order-submit">${t('submit')}</button>
          </div>

          <div class="order-error" id="order-error"></div>
        </form>

      </div>
    `;

    const form = $('#order-form');
    const errorBox = $('#order-error');
    const submitBtn = $('#order-submit');

    bindZipCity();
    bindLeadCapture(product, qty);

    if (window.NovaPixel) {
      window.NovaPixel.setCustomer({
        name: $('#o-name') ? $('#o-name').value.trim() : '',
        phone: $('#o-phone') ? $('#o-phone').value.trim() : '',
        city: $('#cf-city') ? $('#cf-city').value.trim() : '',
        zip: $('#cf-zip') ? $('#cf-zip').value.trim() : '',
        province: $('#cf-province') ? $('#cf-province').value.trim() : '',
      });
      window.NovaPixel.track('InitiateCheckout', {
        content_ids: [String(product.id)],
        content_name: product.name,
        content_type: 'product',
        value: total,
        currency: window.NovaPixel.currency,
        num_items: qty,
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#o-name').value.trim();
      const phone = $('#o-phone').value.trim();
      const street = $('#cf-street').value.trim();
      const zip = $('#cf-zip').value.trim();
      const city = $('#cf-city').value.trim();

      if (!name || !phone) { showError(t('err_required_name_phone')); return; }
      if (!street) { showError(t('err_required_street')); return; }
      if (!zip) { showError(t('err_required_zip')); return; }
      if (!/^\d{5}$/.test(zip)) { showError(t('err_zip_format')); return; }
      if (!city) { showError(t('err_required_city')); return; }

      errorBox.classList.remove('show');
      submitBtn.disabled = true;
      submitBtn.textContent = t('submit_sending');

      const body = {
        sid: leadSid(),
        productId: product.id,
        name, phone, qty,
        location: buildLocationString(),
        address: street,
        zip: zip,
        city: city,
        province: $('#cf-province').value.trim(),
      };
      const { ok, data, status } = await fetchJson('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (ok && data && data.id) {
        showSuccess(data, product);
        logOrderToSheet(data, product);
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = t('submit');
        errorBox.textContent = (data && data.error) || t('err_generic', { status });
        errorBox.classList.add('show');
      }
    });
  }

  function showSuccess(order, product) {
    if (window.NovaPixel) {
      window.NovaPixel.setCustomer({
        name: order && order.name ? order.name : '',
        phone: order && order.phone ? order.phone : '',
        city: order && order.city ? order.city : '',
        zip: order && order.zip ? order.zip : '',
        province: order && order.province ? order.province : '',
      });
      window.NovaPixel.track('Purchase', {
        content_ids: [String(product.id)],
        content_name: product.name,
        content_type: 'product',
        value: Number(order.total) || 0,
        currency: window.NovaPixel.currency,
        num_items: Number(order.qty) || 1,
      });
      window.NovaPixel.track('Lead', {
        content_ids: [String(product.id)],
        content_name: product.name,
        content_type: 'product',
        num_items: Number(order.qty) || 1,
      });
    }
    $('#order-root').innerHTML = `
      <div class="order-success show">
        <div class="ok-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg></div>
        <h2>${t('ok_title')}</h2>
        <div class="ok-ref">${t('ok_ref')} <strong>${escapeHtml(order.code)}</strong></div>

        <div class="ok-card">
          <div class="ok-row"><span>${t('ok_product')}</span><strong>${escapeHtml(product.name)} &times; ${order.qty}</strong></div>
          <div class="ok-row"><span>${t('ok_total')}</span><strong>${currency(order.total)}</strong></div>
          <div class="ok-row"><span>${t('ok_method')}</span><strong>${t('ok_cod')}</strong></div>
        </div>

        <div class="ok-card">
          <div class="ok-delivery-title">${t('ok_delivery_title')}</div>
          <div class="ok-row"><span>${t('ok_name')}</span><strong>${escapeHtml(order.name)}</strong></div>
          <div class="ok-row"><span>${t('ok_phone')}</span><strong dir="ltr">${escapeHtml(order.phone)}</strong></div>
          <div class="ok-row"><span>${t('ok_address')}</span><strong>${escapeHtml(order.location)}</strong></div>
        </div>

        <p class="ok-note">${t('ok_note')}</p>

        <div class="ok-actions">
          <a class="btn btn-accent" href="./#products">${t('ok_continue')}</a>
          <a class="btn btn-outline" href="./">${t('ok_home')}</a>
        </div>
      </div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderNoProduct(msg) {
    $('#order-root').innerHTML = `
      <div style="min-height:50vh;display:grid;place-items:center;text-align:center">
        <div>
          <h1 class="order-title">${t('np_title')}</h1>
          <p class="order-sub">${msg}</p>
          <a class="btn btn-accent" href="./#products">${t('np_back_shop')}</a>
        </div>
      </div>`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const root = $('#order-root');
    if (!root) return;
    const id = Number(new URLSearchParams(location.search).get('id'));
    const qty = Math.max(1, Math.min(99, Number(new URLSearchParams(location.search).get('qty')) || 1));

    (async () => {
      try {
        const { data } = await fetchJson('/api/i18n');
        if (data && typeof data === 'object') OVERRIDES = data;
      } catch (e) { /* usamos el idioma por defecto */ }

      let product = null;
      try {
        const { ok, data } = await fetchJson('/api/products?id=' + id);
        if (ok && data && data.id) product = data;
      } catch (e) { /* fall through */ }
      if (!product && window.NovaStore) {
        product = window.NovaStore.catalog.find((p) => p.id === id) || null;
      }
      if (!product) { renderNoProduct(t('np_notfound')); return; }

      if (window.NOVA_MONEY) {
        try { await window.NOVA_MONEY.ready; } catch (e) { /* keep default */ }
      }

      document.title = t('meta_title') + ' — ' + product.name;
      renderCheckout(product, qty);
    })();
  });
})();