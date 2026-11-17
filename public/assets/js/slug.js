/* =========================================================
   NOVA — Pretty product URLs
   Shared slug builder: used in the browser (store.js) and in
   the Pages build script (scripts/generate-product-pages.js)
   so a product card always points to the folder the build made.
   ========================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.novaSlug = api.novaSlug;
    root.novaSlugFor = api.novaSlugFor;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function novaSlug(name, id) {
    var s = String(name || '');
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* old browser */ }
    s = s.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
    // Arabic / non-Latin names (or empty) fall back to a stable numeric slug.
    if (!s) s = 'producto-' + id;
    return s;
  }

  // Resolve collisions by appending the id only when two products share a base slug.
  function novaSlugFor(product, all) {
    var base = novaSlug(product && product.name, product && product.id);
    var list = Array.isArray(all) ? all : [];
    var clash = list.some(function (p) {
      return p && p.id !== product.id && novaSlug(p.name, p.id) === base;
    });
    return clash ? base + '-' + product.id : base;
  }

  return { novaSlug: novaSlug, novaSlugFor: novaSlugFor };
});
