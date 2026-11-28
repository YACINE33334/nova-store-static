'use strict';
/* =========================================================
   NOVA — Generate one real static page per product:
     /<slug>/index.html   (HTTP 200, canonical, OG tags baked in)

   Reads the live Supabase catalog with the PUBLISHABLE (anon) key
   already used by the storefront, and clones product.html with:
     - absolute asset paths (so it works from a subfolder)
     - the product id injected for product.js
     - title / description / Open Graph / canonical pre-rendered

   Usage: node scripts/generate-product-pages.js <site-dir>
   ========================================================= */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { novaSlugFor } = require('../public/assets/js/slug.js');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.resolve(process.argv[2] || path.join(ROOT, '_site'));
const TEMPLATE = path.join(ROOT, 'public', 'product.html');

const SB_URL = process.env.SUPABASE_URL || 'https://uoejjzfuhfogtkcnujih.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON || 'sb_publishable_9BELNhWaEEKu3fWm6ZtrZw_Zz6gzY2x';
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://valenfort.online';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fetchRest(resource) {
  const url = SB_URL + '/rest/v1/' + resource;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        apikey: SB_KEY,
        Authorization: 'Bearer ' + SB_KEY,
        Accept: 'application/json',
        'User-Agent': 'nova-pages-generator/1',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('Supabase HTTP ' + res.statusCode + ' ' + body.slice(0, 200)));
        }
        let rows;
        try { rows = JSON.parse(body); } catch (e) { return reject(new Error('Invalid JSON from Supabase')); }
        resolve(rows);
      });
    }).on('error', reject);
  });
}

function fetchProducts() {
  return fetchRest('products?select=id,data&order=id.asc')
    .then((rows) => rows.map((r) => Object.assign({ id: r.id }, r.data || {})));
}

// Boot settings are baked in so the product page never waits on Supabase to paint.
function fetchSettings() {
  return fetchRest('settings?select=key,value')
    .then((rows) => {
      const out = {};
      rows.forEach((r) => {
        if (!r || !r.key) return;
        let v = r.value;
        if (v != null) { try { v = JSON.parse(v); } catch (e) { /* keep raw */ } }
        out[r.key] = v;
      });
      // Exit-offer default: 4 EUR until the admin saves another value.
      // 0 means the offer is disabled and must stay 0.
      if (out.exitDiscount == null || out.exitDiscount === '') out.exitDiscount = 4;
      const d = Number(out.exitDiscount);
      out.exitDiscount = Number.isFinite(d) && d >= 0 ? Math.min(999, d) : 4;
      return out;
    })
    .catch(() => ({}));
}

function absoluteHtml(html) {
  return html
    .replace(/(href|src)="assets\//g, '$1="/assets/')
    .replace(/(href|src)="(?!\/|#|https?:|data:|mailto:|tel:)([^"]+)"/g, (m, attr, val) => {
      let v = val;
      if (v === './') v = '/';
      else if (v.startsWith('#')) return m;
      else v = '/' + v.replace(/^\.\//, '');
      return attr + '="' + v + '"';
    })
    .replace(/location\.href='(?!\/|https?:)([^']+)'/g, (m, v) => "location.href='/" + v.replace(/^\.\//, '') + "'");
}

function buildPage(template, product, slug, settings) {
  const title = (product.headline || product.name || 'Producto') + ' — NOVA';
  let rawDesc = String(product.desc || product.lead || '')
    .replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  // Video/image-only descriptions need a readable fallback (Meta/Google previews).
  if (!rawDesc && Array.isArray(product.features) && product.features.length) {
    rawDesc = product.features.join('. ');
  }
  if (!rawDesc) {
    rawDesc = 'Descubre ' + (product.name || 'nuestro producto') + ' en NOVA. Envío gratis y pago contra reembolso.';
  }
  const desc = rawDesc.slice(0, 160);
  const url = SITE_ORIGIN + '/' + slug + '/';
  const image = (product.images && product.images[0]) || '';

  const meta = `
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:url" content="${esc(url)}" />
  ${image ? `<meta property="og:image" content="${esc(image)}" />` : ''}`;

  // JSON is escaped so a product description containing </script> cannot break out.
  const boot = JSON.stringify({ id: product.id, product, settings: settings || {} })
    .replace(/</g, '\\u003c').replace(/&/g, '\\u0026');

  // Tiny early pixel stub: product.js can fire ViewContent before pixel.js is
  // loaded (delayed until the browser is idle). Events replay on activation.
  const currencyCode = String((settings && settings.currency) || 'USD')
    .replace(/^["']|["']$/g, '').toUpperCase();
  const stub = [
    '(function(){var q=[],c=null;',
    'window.NovaPixel={__early:true,__queue:q,',
    'get ready(){return false;},get pixels(){return []},',
    'get currency(){return ' + JSON.stringify(currencyCode) + ';},',
    'get capiEnabled(){return false;},',
    'setCustomer:function(x){c=x||null;},',
    'track:function(e,p){q.push({event:e,params:p,customer:c});return this;}};})();',
  ].join('');
  const refresh = 'window.NOVA_REFRESH=' + JSON.stringify({
    id: Number(product.id),
    url: SB_URL + '/rest/v1',
    key: SB_KEY,
  }) + ';';

  let html = template
    .replace('<title>Producto — NOVA</title>', '<title>' + esc(title) + '</title>')
    .replace('<meta name="description" content="" />', '<meta name="description" content="' + esc(desc) + '" />')
    .replace('<meta id="og-title" property="og:title" content="" />', '<meta id="og-title" property="og:title" content="' + esc(title) + '" />')
    .replace('<meta id="og-desc" property="og:description" content="" />', '<meta id="og-desc" property="og:description" content="' + esc(desc) + '" />')
    .replace('<!--NOVA_PRODUCT_META-->', meta)
    .replace('<!--NOVA_PRODUCT_ID-->', '<script>window.NOVA_BOOT=' + boot + ';window.NOVA_PRODUCT_ID=' + Number(product.id) + ';' + stub + refresh + '</script>');

  // A Facebook-ad visitor only needs this product: no Supabase SDK, no catalog
  // and no REST shim on the landing page. The pixel is loaded when idle.
  const leanScripts = [
    '<script src="/assets/js/currency.js?v=4"></script>',
    '<script src="/assets/js/product.js?v=51"></script>',
    '<script>',
    '(function(){var load=function(){if(document.querySelector("script[data-nova-pixel]"))return;',
    'var s=document.createElement("script");s.src="/assets/js/pixel.js?v=6";s.async=true;',
    's.setAttribute("data-nova-pixel","");document.head.appendChild(s);};',
    'if("requestIdleCallback" in window)requestIdleCallback(load,{timeout:2500});',
    'else window.addEventListener("load",function(){setTimeout(load,0);});})();',
    '</script>',
    '<script>',
    '(function(){var load=function(){if(document.querySelector("script[data-nova-offer]"))return;',
    'var s=document.createElement("script");s.src="/assets/js/exit-offer.js?v=4";s.async=true;',
    's.setAttribute("data-nova-offer","");document.head.appendChild(s);};',
    'if("requestIdleCallback" in window)requestIdleCallback(load,{timeout:2000});',
    'else window.addEventListener("load",function(){setTimeout(load,0);});})();',
    '</script>',
  ].join('\n  ');

  const heavy = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2"><\/script>[\s\S]*?<script src="\/assets\/js\/product\.js\?v=\d+"><\/script>/;
  if (!heavy.test(html)) throw new Error('Heavy script block not found in template');
  html = html.replace(heavy, leanScripts);
  if (html.includes('/assets/js/store.js') || html.includes('/assets/js/api.js') || html.includes('/assets/js/nova-supabase.js')) {
    throw new Error('Generated page still loads store/SDK scripts');
  }
  return html;
}

(async () => {
  const template = absoluteHtml(fs.readFileSync(TEMPLATE, 'utf8'));
  const [products, settings] = await Promise.all([fetchProducts(), fetchSettings()]);
  const slugs = products.map((p) => novaSlugFor(p, products));

  const seen = new Set();
  products.forEach((p, i) => {
    const slug = slugs[i];
    if (seen.has(slug)) throw new Error('Duplicate slug: ' + slug);
    seen.add(slug);

    const dir = path.join(SITE, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), buildPage(template, p, slug, settings), 'utf8');
    console.log('/' + slug + '/  <- ' + p.id + ' ' + (p.name || ''));
  });

  console.log('Generated ' + products.length + ' product pages into ' + SITE);
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
