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
      rows.forEach((r) => { if (r && r.key) out[r.key] = r.value; });
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

  return template
    .replace('<title>Producto — NOVA</title>', '<title>' + esc(title) + '</title>')
    .replace('<meta name="description" content="" />', '<meta name="description" content="' + esc(desc) + '" />')
    .replace('<meta id="og-title" property="og:title" content="" />', '<meta id="og-title" property="og:title" content="' + esc(title) + '" />')
    .replace('<meta id="og-desc" property="og:description" content="" />', '<meta id="og-desc" property="og:description" content="' + esc(desc) + '" />')
    .replace('<!--NOVA_PRODUCT_META-->', meta)
    .replace('<!--NOVA_PRODUCT_ID-->', '<script>window.NOVA_BOOT=' + boot + ';window.NOVA_PRODUCT_ID=' + Number(product.id) + ';</script>');
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
