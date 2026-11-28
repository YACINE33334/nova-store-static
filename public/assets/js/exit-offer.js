/* =========================================================
   NOVA — Oferta de salida (exit intent).

   Se carga en idle SOLO en las páginas de producto generadas.
   Muestra el descuento configurado en Ajustes → General y lo
   entrega al checkout (order.js) por sessionStorage + ?disc=.
   El importe es real: llega al total, al pedido, al Sheet y al
   pixel de compra.
   ========================================================= */
(function () {
  'use strict';

  var boot = window.NOVA_BOOT || {};
  var product = boot.product || {};
  var settings = boot.settings || {};
  var id = Number(boot.id || product.id);
  var discount = Number(settings.exitDiscount);
  if (!id || !Number.isFinite(discount)) return;

  var KEY_SHOWN = 'nova_exit_shown';
  var KEY_DISC = 'nova_exit_discount';

  function get(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function set(key, val) { try { sessionStorage.setItem(key, val); } catch (e) { /* privado */ } }
  function remove(key) { try { sessionStorage.removeItem(key); } catch (e) { /* privado */ } }

  function pack() {
    var chosen = Number(product.orderPieces);
    var qty = Number.isFinite(chosen) && chosen >= 1
      ? Math.max(1, Math.min(99, Math.round(chosen))) : 1;
    var unit = Number(product.price) || 0;
    var custom = (product.orderPrice === '' || product.orderPrice == null)
      ? NaN : Number(product.orderPrice);
    var total = Number.isFinite(custom) && custom >= 0 ? custom : unit * qty;
    return { qty: qty, total: total };
  }

  function money(n) {
    try { if (window.novaMoney) return window.novaMoney(n); } catch (e) { /* fallback */ }
    return (Number(n) || 0).toLocaleString('en-US') + ' \u20ac';
  }

  var css = [
    '.nova-exit{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;',
    'padding:18px;background:rgba(10,10,12,.62);backdrop-filter:blur(3px);',
    'font-family:Inter,Arial,sans-serif;animation:novaExitIn .18s ease-out}',
    '@keyframes novaExitIn{from{opacity:0}to{opacity:1}}',
    '.nova-exit-card{width:min(100%,400px);background:#fff;border-radius:16px;padding:26px 24px 22px;',
    'box-shadow:0 24px 70px rgba(0,0,0,.3);text-align:center;color:#161616}',
    '.nova-exit-ic{width:52px;height:52px;margin:0 auto 12px;border-radius:50%;',
    'display:grid;place-items:center;background:#e8f8ee;color:#16a34a}',
    '.nova-exit-ic svg{width:28px;height:28px}',
    '.nova-exit-card h2{margin:0 0 8px;font-size:23px;font-weight:800;letter-spacing:-.02em}',
    '.nova-exit-card p{margin:0;font-size:15px;line-height:1.45;color:#444}',
    '.nova-exit-price{margin:14px 0 7px;font-size:15px;color:#666}',
    '.nova-exit-price s{margin-right:10px;color:#999}',
    '.nova-exit-price strong{font-size:22px;font-weight:800;color:#161616}',
    '.nova-exit-note{margin:0 0 16px;font-size:12.5px;color:#777}',
    '.nova-exit-btns{display:grid;gap:9px}',
    '.nova-exit-btn{border:0;border-radius:12px;padding:13px 16px;font-size:15px;font-weight:800;cursor:pointer}',
    '.nova-exit-btn.go{background:#16a34a;color:#fff}',
    '.nova-exit-btn.go:hover{background:#15803d}',
    '.nova-exit-btn.no{background:transparent;color:#525252;font-weight:600;font-size:13.5px}',
    '.nova-exit-btn.no:hover{color:#161616}',
    '@media (max-width:520px){.nova-exit-card{margin:0 16px;width:auto}}',
    '@media (prefers-reduced-motion:reduce){.nova-exit{animation:none}}'
  ].join('');

  /* El valor horneado es inmediato; una micro-consulta en idle recoge cambios
     del panel de administración sin necesidad de un nuevo despliegue. */
  function readFresh(done) {
    var cfg = window.NOVA_REFRESH;
    if (!cfg || !cfg.url || !cfg.key) { done(); return; }
    fetch(cfg.url + '/settings?select=key,value', {
      headers: { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
      cache: 'no-store',
    }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
      if (Array.isArray(rows)) {
        rows.forEach(function (row) {
          if (!row || row.key !== 'exitDiscount') return;
          var v;
          try { v = JSON.parse(row.value); } catch (e) { v = row.value; }
          v = Number(v);
          discount = Number.isFinite(v) && v >= 0 ? Math.min(999, v) : 0;
        });
      }
      done();
    }).catch(done);
  }

  function init() {
    discount = Math.min(999, Math.round(discount * 100) / 100);
    // Quien ya pulsó «Comprar ahora» o ya aceptó no necesita la oferta.
    if (discount <= 0 || get(KEY_SHOWN) || get(KEY_DISC)) return;

    var shown = false;
    var lastTouchY = null;
    var idleTimer = null;

    function armIdle() {
      if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(show, 30000);
    }
    ['touchstart', 'touchend', 'click', 'scroll', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, armIdle, { passive: true });
    });

    function close(declined) {
      var box = document.querySelector('.nova-exit');
      if (box) box.remove();
      if (declined) remove(KEY_DISC);
    }

    function show() {
      if (shown || document.querySelector('.nova-exit')) return;
      shown = true;
      set(KEY_SHOWN, '1');
      clearTimeout(idleTimer);

      var p = pack();
      var off = Math.min(discount, p.total);
      var finalTotal = Math.max(0, p.total - off);

      var style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);

      var wrap = document.createElement('div');
      wrap.className = 'nova-exit';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-labelledby', 'nova-exit-title');
      wrap.innerHTML =
        '<div class="nova-exit-card">' +
          '<div class="nova-exit-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v9H4v-9"/><rect x="2" y="7" width="20" height="5" rx="1"/><path d="M12 21V7"/><path d="M12 7C9.8 7 7 6.3 7 4.5A2.5 2.5 0 0 1 9.5 2C11.5 2 12 4.5 12 7Z"/><path d="M12 7c2.2 0 5-.7 5-2.5A2.5 2.5 0 0 0 14.5 2C12.5 2 12 4.5 12 7Z"/></svg></div>' +
          '<h2 id="nova-exit-title">\u00a1Ahorra ' + money(off) + ' hoy!</h2>' +
          '<div class="nova-exit-price">Precio especial para ti: <s>' + money(p.total) + '</s><strong>' + money(finalTotal) + '</strong></div>' +
          '<p class="nova-exit-note">Pagas al recibir tu pedido</p>' +
          '<div class="nova-exit-btns">' +
            '<button type="button" class="nova-exit-btn go" id="nova-exit-go">Aplicar descuento y continuar</button>' +
            '<button type="button" class="nova-exit-btn no" id="nova-exit-no">Salir sin descuento</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);

      document.getElementById('nova-exit-go').addEventListener('click', function () {
        set(KEY_DISC, String(off));
        set(KEY_SHOWN, '1');
        location.href = '/order.html?id=' + encodeURIComponent(id)
          + '&disc=' + encodeURIComponent(off);
      });
      document.getElementById('nova-exit-no').addEventListener('click', function () { close(true); });
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(true); });
      document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape') { close(true); document.removeEventListener('keydown', esc); }
      });
    }

    /* Escritorio: el cursor sale por el borde superior. */
    document.addEventListener('mouseout', function (e) {
      if (!e.relatedTarget && e.clientY <= 0) show();
    });

    /* Móvil: gesto hacia arriba desde lo más alto de la página. */
    document.addEventListener('touchstart', function (e) {
      lastTouchY = e.touches && e.touches[0] ? e.touches[0].clientY : null;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      var y = e.touches && e.touches[0] ? e.touches[0].clientY : null;
      if (y != null && lastTouchY != null && lastTouchY - y > 65 && (window.scrollY || 0) <= 2) show();
      lastTouchY = y;
    }, { passive: true });

    /* Ya pulsó el botón de compra -> no molestar. */
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('#p-buy, a[href*="order.html"]') : null;
      if (el) set(KEY_SHOWN, '1');
    });

    armIdle();
  }

  readFresh(init);
})();
