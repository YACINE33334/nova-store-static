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
    // Only the first 3 letters of the name + the id, e.g. "Collar Rosa de Sangre" -> col-29.
    var letters = s.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
    // Arabic / non-Latin names (or empty) fall back to a stable numeric slug.
    if (!letters) return 'producto-' + id;
    return letters + '-' + id;
  }

  // The id is always included, so two products sharing the same first 3 letters
  // can never collide (e.g. rel-11 and rel-28).
  function novaSlugFor(product, all) {
    return novaSlug(product && product.name, product && product.id);
  }

  return { novaSlug: novaSlug, novaSlugFor: novaSlugFor };
});
