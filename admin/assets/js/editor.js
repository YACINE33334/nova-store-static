/* =========================================================
   NOVA — Product landing page editor (persists via /api/products)
   ========================================================= */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const fmt = (n) => (window.novaMoney ? window.novaMoney(n) : '$' + Number(n || 0).toLocaleString('en-US'));

  let savedRange = null;

  function captureCaret() {
    const rt = $('#f-desc-rt');
    if (!rt) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (rt.contains(r.startContainer) && rt.contains(r.endContainer)) {
      savedRange = r.cloneRange();
    }
  }

  function insertImageHtml(url) {
    const rt = $('#f-desc-rt');
    rt.focus();
    const sel = window.getSelection();
    let range = null;
    if (savedRange) {
      range = savedRange.cloneRange();
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (sel.rangeCount) {
      range = sel.getRangeAt(0);
    }
    const img = document.createElement('img');
    img.src = url;
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    if (range) {
      range.collapse(false);
      range.insertNode(img);
      range.setStartAfter(img);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      rt.appendChild(img);
    }
    rt.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function videoTypeFor(url) {
    const m = /\.(mp4|webm|ogv|ogg|mov)(?:$|[?#])/i.exec(String(url || ''));
    if (!m) return '';
    const t = { mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', ogg: 'video/ogg', mov: 'video/quicktime' }[m[1].toLowerCase()];
    return t || '';
  }

  function insertVideoHtml(url) {
    const rt = $('#f-desc-rt');
    rt.focus();
    const sel = window.getSelection();
    let range = null;
    if (savedRange) {
      range = savedRange.cloneRange();
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (sel.rangeCount) {
      range = sel.getRangeAt(0);
    }
    const vid = document.createElement('video');
    vid.controls = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    vid.style.maxWidth = '100%';
    vid.style.borderRadius = '12px';
    const src = document.createElement('source');
    src.src = url;
    const t = videoTypeFor(url);
    if (t) src.type = t;
    vid.appendChild(src);
    if (range) {
      range.collapse(false);
      range.insertNode(vid);
      range.setStartAfter(vid);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      rt.appendChild(vid);
    }
    rt.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---- Hybrid description editor: Normal (WYSIWYG) <-> HTML (code) ---- */
  let descMode = 'normal';

  function cleanDesc(html) {
    if (!html) return '';
    let h = String(html).replace(/&nbsp;/g, ' ').trim();
    h = h.replace(/^(<br\s*\/?>[^<>]*)+$/i, '');
    if (h === '<div></div>' || h === '<p></p>' || h === '<br>' || h === '<div><br></div>' || h === '') return '';
    return h;
  }

  function syncNormalToHtml() {
    const ta = $('#f-desc-html');
    if (!ta) return;
    const rt = $('#f-desc-rt');
    ta.value = cleanDesc(rt ? rt.innerHTML : '');
  }

  function syncHtmlToNormal() {
    const rt = $('#f-desc-rt');
    if (!rt) return;
    const ta = $('#f-desc-html');
    rt.innerHTML = ta ? cleanDesc(ta.value) : '';
  }

  function descValue(clean) {
    if (descMode === 'html') {
      const ta = $('#f-desc-html');
      const v = ta ? ta.value : '';
      return clean ? cleanDesc(v) : v;
    }
    const rt = $('#f-desc-rt');
    const v = rt ? rt.innerHTML : '';
    return clean ? cleanDesc(v) : v;
  }

  function setDescMode(mode) {
    if (mode === descMode) return;
    const from = descMode;
    if (from === 'normal' && mode === 'html') syncNormalToHtml();
    if (from === 'html' && mode === 'normal') syncHtmlToNormal();
    descMode = mode;
    document.querySelectorAll('.ed-rt-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    const normal = $('#ed-rt-panel-normal');
    const htmlP = $('#ed-rt-panel-html');
    if (normal) normal.hidden = mode !== 'normal';
    if (htmlP) htmlP.hidden = mode !== 'html';
    refreshDescPreview();
  }

  function insertHtmlVideo(url) {
    const ta = $('#f-desc-html');
    if (!ta) return;
    const t = videoTypeFor(url);
    const tag = '<video controls playsinline preload="metadata" style="max-width:100%;height:auto;border-radius:12px;">'
      + '<source src="' + url + '"' + (t ? ' type="' + t + '"' : '') + ' />'
      + '</video>';
    const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const end = ta.selectionEnd != null ? ta.selectionEnd : start;
    ta.value = ta.value.slice(0, start) + tag + ta.value.slice(end);
    const np = start + tag.length;
    ta.focus();
    ta.setSelectionRange(np, np);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    refreshDescPreview();
  }

  /* ---- shared uploader: posts raw body to /api/upload (XHR shim →
       NS.uploadBytes → Supabase Storage) and calls the insert callback ---- */
  function uploadToDesc(file, opts, onOk) {
    const label = opts.label;
    label.classList.add('busy');
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.onload = () => {
        label.classList.remove('busy');
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const r = JSON.parse(xhr.responseText);
            if (r.url) {
              onOk(r.url, r.type || file.type || '');
              if (opts.input) opts.input.value = '';
            } else {
              toast('خطأ في الرفع: ' + (r.error || 'غير معروف'));
            }
          } catch (e) { toast('استجابة غير صالحة من الخادم'); }
        } else {
          try {
            const r = JSON.parse(xhr.responseText);
            toast('فشل الرفع: ' + (r.error || xhr.status));
          } catch (e) { toast('فشل الرفع: ' + xhr.status); }
        }
      };
      xhr.onerror = () => {
        label.classList.remove('busy');
        toast('تعذر الاتصال بالخادم أثناء الرفع');
      };
      xhr.onabort = () => label.classList.remove('busy');
      xhr.ontimeout = () => {
        label.classList.remove('busy');
        toast('انتهت مهلة رفع الملف');
      };
      xhr.send(file);
    } catch (err) {
      label.classList.remove('busy');
      console.error('[editor] upload failed to start:', err);
      toast('تعذر بدء الرفع');
    }
  }

  function isVideoFile(f) {
    return !!f && (/^video\//i.test(f.type) || /\.(mp4|webm|ogv|ogg|mov)$/i.test(f.name || ''));
  }

  function bindDescModes() {
    document.querySelectorAll('.ed-rt-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setDescMode(btn.dataset.mode));
    });
  }

  function selectedVideoIn() {
    const rt = $('#f-desc-rt');
    if (!rt) return null;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!rt.contains(r.startContainer) && !rt.contains(r.endContainer)) return null;
    let node = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
    for (let i = 0; node && i < 6; i++) {
      if (node.tagName && node.tagName.toLowerCase() === 'video') return node;
      node = node.parentElement;
    }
    return null;
  }

  function bindVideoDelete() {
    const btn = $('#ed-rt-video-del');
    const rt = $('#f-desc-rt');
    if (!btn || !rt) return;
    const update = () => {
      const v = selectedVideoIn();
      btn.disabled = !v;
    };
    rt.addEventListener('mouseup', update);
    rt.addEventListener('keyup', update);
    rt.addEventListener('click', update);
    rt.addEventListener('focus', update);
    document.addEventListener('selectionchange', () => { if (document.activeElement === rt) update(); });
    btn.addEventListener('click', () => {
      const v = selectedVideoIn();
      if (!v) return;
      const src = v.querySelector('source').getAttribute('src') || '';
      if (src) removeStoredImage(src);
      v.remove();
      rt.dispatchEvent(new Event('input', { bubbles: true }));
      refreshDescPreview();
      update();
    });
  }

  function bindDescPaste() {
    const rt = $('#f-desc-rt');
    if (!rt) return;
    rt.addEventListener('paste', (e) => {
      const html = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData('text/html') : '';
      const txt = e.clipboardData && e.clipboardData.getData ? e.clipboardData.getData('text/plain') : '';
      if (html && /<video|<iframe/.test(html)) {
        e.preventDefault();
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        wrap.querySelectorAll('script, iframe').forEach((n) => n.remove());
        document.execCommand('insertHTML', false, wrap.innerHTML);
      } else if (txt && /^https?:\/\/\S+\.(mp4|webm|mov|ogv)([?#]\S*)?$/i.test(txt.trim())) {
        e.preventDefault();
        const url = txt.trim();
        insertVideoHtml(url.split(/[?#]/)[0]);
      }
    });
  }

  function refreshDescPreview() {
    const rt = $('#f-desc-rt');
    if (rt) rt.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* ---- Rich text "upload image/video from disk" (works in new + edit mode) ---- */
  function bindRichTextUpload() {
    document.querySelectorAll('#ed-rt-panel-normal .ed-rt-upload').forEach((label) => {
      const inp = label.querySelector('input[type=file]');
      if (!inp) return;
      label.addEventListener('mousedown', captureCaret);
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        uploadToDesc(file, { label, input: inp }, (url) => {
          if (isVideoFile(file)) insertVideoHtml(url);
          else insertImageHtml(url);
        });
      });
    });
  }

  /* ---- HTML mode "upload image/video from disk" (inserts tags at caret) ---- */
  function bindHtmlUpload() {
    const binds = [
      { labelSel: '#ed-rt-panel-html #ed-rt-upload-image-html input[type=file]', video: false },
      { labelSel: '#ed-rt-panel-html #ed-rt-upload-video-html input[type=file]', video: true },
    ];
    binds.forEach((b) => {
      const inp = document.querySelector(b.labelSel);
      if (!inp) return;
      const label = inp.closest('label');
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        uploadToDesc(file, { label, input: inp }, (url, type) => {
          if (b.video || isVideoFile(file)) insertHtmlVideo(url);
          else insertHtmlImage(url);
        });
      });
    });
  }

  async function apiGetProduct(id) {
    const res = await fetch('/api/products?id=' + id, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }
  async function apiSaveProduct(p) {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const t = await res.json(); if (t && t.error) msg = t.error; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    return res.json();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function removeStoredImage(src) {
    try {
      if (window.NovaSupabase && typeof window.NovaSupabase.deleteObject === 'function') {
        window.NovaSupabase.deleteObject(src).catch(function () {});
      }
    } catch (e) { /* non-fatal */ }
  }

  function mediaUrlsIn(html) {
    const out = [];
    if (!html) return out;
    const wrap = document.createElement('div');
    wrap.innerHTML = String(html);
    wrap.querySelectorAll('img, video source, source').forEach((s) => {
      const u = (s.getAttribute('src') || '').trim();
      if (u && out.indexOf(u) === -1) out.push(u);
    });
    return out;
  }

  /* Deletes files that were present in a previously saved description but are
     no longer referenced (e.g. the user removed a <video>/<img> before saving). */
  function cleanupRemovedMedia(prevDesc, newDesc) {
    try {
      const prev = new Set(mediaUrlsIn(prevDesc));
      const next = new Set(mediaUrlsIn(newDesc));
      prev.forEach((u) => {
        if (!next.has(u)) removeStoredImage(u);
      });
    } catch (e) { /* non-fatal */ }
  }

  function renderNotFound() {
    document.body.innerHTML = `
      <div style="max-width:480px;margin:80px auto;text-align:center">
        <h1 style="font-size:22px;margin-bottom:8px">المنتج غير موجود</h1>
        <p style="color:var(--ink-soft);margin-bottom:20px">لم نتمكن من العثور على المنتج المطلوب.</p>
        <a class="btn btn-primary" href="index.html#products">العودة للمنتجات</a>
      </div>`;
  }

  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast show success';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2000);
  }

  /* ---- Shared reviews section (works in new + edit mode) ---- */
  function initReviews(data) {
    if (!Array.isArray(data.reviewsArray)) data.reviewsArray = [];
    const wrap = $('#ed-reviews');
    if (!wrap) return;

    function addReviewBlock(index) {
      const empty = wrap.querySelector('.ed-empty');
      if (empty) empty.remove();

      const rv = data.reviewsArray[index] || {};
      if (!Array.isArray(rv.imgs)) rv.imgs = [];
      const block = document.createElement('div');
      block.className = 'ed-review';
      block.innerHTML = `
          <div class="ed-review-head">
            <span class="ed-review-title">مراجعة #${index + 1}</span>
            <button class="ed-img-del" type="button" aria-label="حذف المراجعة">&times;</button>
          </div>
          <div class="ed-grid-3">
            <div class="form-group"><label class="form-label">الاسم</label><input class="input rv-n" value="${esc(rv.n || '')}" placeholder="Carmen Ruiz" /></div>
            <div class="form-group"><label class="form-label">البلد</label><input class="input rv-c" value="${esc(rv.c || '')}" placeholder="España" /></div>
            <div class="form-group"><label class="form-label">التاريخ</label><input class="input rv-d" value="${esc(rv.d || '')}" placeholder="el 15 de agosto de 2026" /></div>
          </div>
          <div class="ed-grid-3">
            <div class="form-group"><label class="form-label">تقييم المراجعة</label><select class="input rv-pol">
              <option value="pos" ${(rv.pol || 'pos') === 'pos' ? 'selected' : ''}>Positivos (إيجابي)</option>
              <option value="neg" ${rv.pol === 'neg' ? 'selected' : ''}>Negativos (سلبي)</option>
            </select></div>
            <div class="form-group"><label class="form-label">النجوم (1-5)</label><input class="input rv-s" type="number" min="1" max="5" value="${rv.s || 5}" /></div>
            <div class="form-group"><label class="form-label">عنوان المراجعة</label><input class="input rv-title" value="${esc(rv.title || '')}" placeholder="Calidad excelente" /></div>
          </div>
          <div class="form-group">
            <label class="form-label">صور المراجعة</label>
            <div class="rv-imgs-wrap"></div>
            <button class="btn btn-secondary btn-sm rv-img-add" type="button">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              إضافة صورة
            </button>
          </div>
          <div class="form-group"><label class="form-label">نص المراجعة (كل فقرة في سطر)</label><textarea class="textarea rv-body" placeholder="الفقرة الأولى&#10;الفقرة الثانية">${esc(Array.isArray(rv.body) ? rv.body.join('\n') : rv.body || '')}</textarea></div>
        `;

      const imgsWrap = block.querySelector('.rv-imgs-wrap');
      function renderRvImgRows() {
        imgsWrap.innerHTML = '';
        rv.imgs.forEach((src, ii) => {
          const row = document.createElement('div');
          row.className = 'ed-img-row';
          row.innerHTML = `
              <input class="input ed-img-input" value="${esc(src)}" placeholder="رابط الصورة أو ارفع من الجهاز" dir="ltr" />
              <label class="ed-img-upload" title="رفع صورة من الجهاز">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 19 5-5 3 3 3-3 5 5"/></svg>
              </label>
              <button class="ed-img-del" type="button" aria-label="حذف الصورة">&times;</button>`;
          row.querySelector('.ed-img-input').addEventListener('input', (e) => { rv.imgs[ii] = e.target.value.trim(); });
          row.querySelector('.ed-img-upload input[type=file]').addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const btn = row.querySelector('.ed-img-upload');
            const prev = row.querySelector('.ed-img-input').value;
            btn.classList.add('busy');
            try {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', '/api/upload');
              xhr.setRequestHeader('Content-Type', file.type);
              xhr.onload = () => {
                btn.classList.remove('busy');
                if (xhr.status >= 200 && xhr.status < 300) {
                  try {
                    const r = JSON.parse(xhr.responseText);
                    if (r.url) {
                      row.querySelector('.ed-img-input').value = r.url; rv.imgs[ii] = r.url;
                      if (prev && prev !== r.url) removeStoredImage(prev);
                    }
                    else { toast('خطأ: ' + (r.error || '')); }
                  } catch (err) { toast('استجابة غير صالحة'); }
                } else {
                  try { toast('فشل الرفع: ' + (JSON.parse(xhr.responseText).error || xhr.status)); }
                  catch (err) { toast('فشل الرفع: ' + xhr.status); }
                }
              };
              xhr.onerror = () => { btn.classList.remove('busy'); toast('تعذر الاتصال'); };
              xhr.send(file);
              e.target.value = '';
            } catch (err) {
              btn.classList.remove('busy');
              console.error('[editor] upload failed to start:', err);
          toast('تعذر بدء الرفع');
            }
          });
          row.querySelector('.ed-img-del').addEventListener('click', () => {
            removeStoredImage(rv.imgs[ii]);
            rv.imgs.splice(ii, 1);
            renderRvImgRows();
          });
          imgsWrap.appendChild(row);
        });
      }
      renderRvImgRows();

      block.querySelector('.rv-img-add').addEventListener('click', () => {
        rv.imgs.push('');
        renderRvImgRows();
      });

      ['rv-n', 'rv-c', 'rv-d', 'rv-title'].forEach((cls) => {
        block.querySelector('.' + cls).addEventListener('input', (e) => { rv[cls.slice(3)] = e.target.value.trim(); });
      });
      block.querySelector('.rv-s').addEventListener('input', (e) => { rv.s = Math.max(1, Math.min(5, Number(e.target.value) || 5)); });
      block.querySelector('.rv-pol').addEventListener('change', (e) => { rv.pol = e.target.value; });
      block.querySelector('.rv-body').addEventListener('input', (e) => { rv.body = e.target.value.split(/\n+/).map((s) => s.trim()).filter(Boolean); });
      block.querySelector('.ed-img-del').addEventListener('click', () => {
        data.reviewsArray.splice(index, 1);
        renderReviewBlocks();
      });
      wrap.appendChild(block);
    }

    function renderReviewBlocks() {
      wrap.innerHTML = '';
      if (!data.reviewsArray.length) {
        const empty = document.createElement('div');
        empty.className = 'ed-empty';
        empty.textContent = 'لا توجد مراجعات مخصّصة. تُعرض حالياً المراجعات العامة؛ أضف مراجعة لتفعيل المراجعات الخاصة بالمنتج.';
        wrap.appendChild(empty);
        return;
      }
      data.reviewsArray.forEach((_, i) => addReviewBlock(i));
    }

    const addBtn = $('#ed-review-add');
    if (addBtn) addBtn.addEventListener('click', () => {
      data.reviewsArray.push({ n: '', c: '', d: '', s: 5, title: '', body: [], imgs: [], pol: 'pos' });
      addReviewBlock(data.reviewsArray.length - 1);
    });

    renderReviewBlocks();
  }

  /* ---- Translation editor saved-state (shared with main save button) ---- */
  const I18N_DEFAULTS = (window.NOVA_I18N_DEFAULTS) || {};
  let i18nState = {};
  let i18nLoaded = false;

  function countI18N() {
    let n = 0;
    Object.keys(i18nState).forEach((k) => { if (String(i18nState[k] || '').trim() !== '') n++; });
    return n;
  }

  function updateI18nBadge() {
    const b = $('#ed-i18n-badge');
    if (!b) return;
    const n = countI18N();
    b.textContent = n ? String(n) : '';
    b.style.display = n ? 'inline-flex' : 'none';
  }

  // Posts the current translations. Returns the saved count (or null if the editor never loaded).
  async function saveI18N(showToast) {
    if (!i18nLoaded) return null;
    const body = {};
    let count = 0;
    Object.keys(i18nState).forEach((k) => {
      const v = String(i18nState[k] || '').trim();
      if (v !== '') { body[k] = v; count++; }
    });
    const res = await fetch('/api/i18n', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (showToast) toast('تم حفظ ' + count + ' ترجمة — افتح صفحة الطلب لمشاهدتها');
    return count;
  }

  /* ---- Translation editor (checkout form language) — replica console ---- */
  function initI18nEditor() {
    if (!window.NOVA_I18N_FIELDS || !window.NOVA_I18N_FIELDS.length) return;
    const sec = $('#ed-i18n-sec');
    if (!sec) return;
    const wrap = $('#ed-i18n');
    if (!wrap) return;
    const D = window.NOVA_I18N_DEFAULTS || {};
    const state = i18nState; // shared with the main save button

    const tpl = `
      <div class="i18n-legend">هذه نسخة مطابقة لصفحة ملء المعلومات التي يراها الزبون. النص الباهت هو <b>الإسبانية الافتراضية</b> — اكتب ترجمتك مكانه مباشرة، واترك أي موضع فارغاً للبقاء على الإسبانية.</div>

      <div class="i18n-stage">
        <div class="i18n-order">

          <div class="i18n-cod">
            <div class="i18n-cod-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 6v6c0 5 3.8 8.4 9 10 5.2-1.6 9-5 9-10V6l-9-4Z"/><path d="M9 12.5l2 2 4-4.5"/></svg></div>
            <div class="i18n-cod-txt">
              <div class="i18n-r"><input class="itx itx-strong" data-k="ck_cod_title"></div>
              <div class="i18n-r"><input class="itx" data-k="ck_cod_sub"></div>
            </div>
          </div>

          <div class="i18n-prod">
            <div class="i18n-thumb">NV</div>
            <div class="i18n-prod-info">
              <div class="demo-name">Nombre del producto de ejemplo</div>
              <div class="i18n-r"><input class="itx itx-inline" data-k="ck_prod_label"> <span class="i18n-literal">&times; x1</span></div>
            </div>
            <div class="i18n-price">$55</div>
          </div>

          <form class="i18n-form" onsubmit="return false">
            <div class="i18n-r"><input class="itx itx-head" data-k="fields_head"></div>
            <div class="i18n-r"><input class="itx" data-k="fields_sub"></div>

            <div class="i18n-fld">
              <div class="i18n-r"><input class="itx itx-label" data-k="name_label"> <span class="i18n-req">*</span></div>
              <div class="i18n-r"><input class="itx itx-input" data-k="name_ph"></div>
            </div>

            <div class="i18n-fld">
              <div class="i18n-r"><input class="itx itx-label" data-k="phone_label"> <span class="i18n-req">*</span></div>
              <div class="i18n-r"><input class="itx itx-input" data-k="phone_ph"></div>
              <div class="i18n-r"><input class="itx itx-hint" data-k="phone_hint"></div>
            </div>

            <div class="i18n-card">
              <div class="i18n-r"><input class="itx itx-title" data-k="ship_title"></div>
              <div class="i18n-grid">
                <div class="i18n-wide">
                  <div class="i18n-r"><input class="itx itx-label" data-k="city_label"> <span class="i18n-req">*</span></div>
                  <div class="i18n-r"><input class="itx itx-input" data-k="city_ph"></div>
                  <div class="i18n-r"><input class="itx itx-hint" data-k="city_hint"></div>
                </div>
                <div class="i18n-wide">
                  <div class="i18n-r"><input class="itx itx-label" data-k="street_label"> <span class="i18n-req">*</span></div>
                  <div class="i18n-r"><input class="itx itx-input" data-k="street_ph"></div>
                </div>
                <div>
                  <div class="i18n-r"><input class="itx itx-label" data-k="prov_label"></div>
                  <div class="i18n-r"><input class="itx itx-input" data-k="prov_ph"></div>
                </div>
                <div>
                  <div class="i18n-r"><input class="itx itx-label" data-k="zip_label"> <span class="i18n-req">*</span></div>
                  <div class="i18n-r"><input class="itx itx-input" data-k="zip_ph"></div>
                </div>
              </div>

              <div class="i18n-r"><input class="itx itx-tog" data-k="map_toggle"></div>

              <div class="i18n-map">
                <div class="i18n-r"><input class="itx itx-input itx-search" data-k="search_ph"></div>
                <div class="i18n-map-box"><span class="i18n-map-hint">mapa de Google</span></div>
                <div class="i18n-r"><input class="itx itx-loc" data-k="loc_use"></div>
                <div class="i18n-r"><input class="itx itx-hint" data-k="loc_hint"></div>
              </div>
            </div>

            <div class="i18n-pay">
              <div class="i18n-pay-price"><div class="i18n-r"><input class="itx itx-label" data-k="pay_label"></div><div class="i18n-amount">$55</div></div>
              <div class="i18n-r"><input class="itx itx-btn" data-k="submit"></div>
            </div>
            <div class="i18n-r"><span class="i18n-literal">بينما يُرسل: </span><input class="itx itx-hint" data-k="submit_sending" style="font-size:12.5px;color:#6b7280"></div>
          </form>

          <div class="i18n-group-label">رسائل الخطأ (تظهر فوق النموذج)</div>
          <div class="i18n-err">
            <div class="i18n-r"><input class="itx itx-err" data-k="err_required_name_phone"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="err_required_street"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="err_required_zip"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="err_zip_format"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="err_required_city"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="err_generic"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="search_not_found"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="locate_no_geo"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="locate_locating"></div>
            <div class="i18n-r"><input class="itx itx-err" data-k="locate_fail"></div>
            <div class="i18n-r itx-meta"><input class="itx itx-hint" data-k="meta_title"></div>
          </div>

          <div class="i18n-group-label">صفحة النجاح (بعد إرسال الطلب)</div>
          <div class="i18n-ok">
            <div class="i18n-r"><input class="itx itx-ok-title" data-k="ok_title"></div>
            <div class="i18n-r"><span class="i18n-literal">${esc(D.ok_ref || 'Referencia')} <b>#12</b></span> <input class="itx itx-inline" data-k="ok_ref"></div>
            <div class="i18n-ok-card">
              <div class="i18n-r"><span class="i18n-literal">~</span> <input class="itx itx-inline" data-k="ok_product"></div>
              <div class="i18n-r"><input class="itx itx-inline" data-k="ok_total"></div>
              <div class="i18n-r"><span class="i18n-literal">=</span> <input class="itx itx-inline" data-k="ok_method"> → <input class="itx itx-inline" data-k="ok_cod"></div>
            </div>
            <div class="i18n-ok-card">
              <div class="i18n-r"><input class="itx itx-ok-sub" data-k="ok_delivery_title"></div>
              <div class="i18n-r"><span class="i18n-literal">:</span> <input class="itx itx-inline" data-k="ok_name"></div>
              <div class="i18n-r"><span class="i18n-literal">:</span> <input class="itx itx-inline" data-k="ok_phone"></div>
              <div class="i18n-r"><span class="i18n-literal">:</span> <input class="itx itx-inline" data-k="ok_address"></div>
            </div>
            <div class="i18n-r"><input class="itx itx-hint" data-k="ok_note"></div>
            <div class="i18n-ok-btns">
              <div class="i18n-r"><input class="itx itx-btn" data-k="ok_continue"></div>
              <div class="i18n-r"><input class="itx itx-btn-outline" data-k="ok_home"></div>
            </div>
          </div>

          <div class="i18n-group-label">صفحة «المنتج غير موجود»</div>
          <div class="i18n-nproduct">
            <div class="i18n-r"><input class="itx itx-ok-title" data-k="np_title"></div>
            <div class="i18n-r"><input class="itx itx-hint" data-k="np_notfound"></div>
            <div class="i18n-r"><input class="itx itx-btn" data-k="np_back_shop"></div>
          </div>

        </div>
      </div>`;

    function render() {
      wrap.innerHTML = tpl;
      wrap.querySelectorAll('.itx').forEach((inp) => {
        const k = inp.dataset.k;
        inp.value = state[k] != null ? state[k] : '';
        inp.placeholder = D[k] != null ? D[k] : '';
        inp.addEventListener('input', () => { state[k] = inp.value; updateI18nBadge(); });
      });
    }

    $('#ed-i18n-save').addEventListener('click', async () => {
      try {
        await saveI18N(true);
        updateI18nBadge();
      } catch (e) {
        toast('تعذر حفظ الترجمات: ' + e.message);
      }
    });

    $('#ed-i18n-clear').addEventListener('click', async () => {
      Object.keys(state).forEach((k) => { state[k] = ''; });
      render();
      updateI18nBadge();
      try {
        const res = await fetch('/api/i18n', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        toast('تمت الإعادة للإسبانية (اللغة الافتراضية)');
      } catch (e) {
        toast('تعذر الحفظ: ' + e.message);
      }
    });

    const pvBtn = $('#ed-i18n-preview');
    if (pvBtn) {
      const pid = new URLSearchParams(location.search).get('id');
      pvBtn.href = '../order.html' + (pid ? '?id=' + encodeURIComponent(pid) + '&qty=1' : '');
    }

    fetch('/api/i18n', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === 'object') {
          window.NOVA_I18N_FIELDS.forEach((fld) => {
            state[fld.key] = (data[fld.key] != null ? String(data[fld.key]) : '') || '';
          });
        }
        i18nLoaded = true;
        render();
        updateI18nBadge();
      })
      .catch(() => { i18nLoaded = true; render(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(location.search);
    const id = Number(params.get('id'));
    const isNew = !id;

    initI18nEditor();
    bindRichTextUpload();
    bindHtmlUpload();
    bindDescModes();
    bindVideoDelete();
    bindDescPaste();

    const boot = () => {
      if (isNew) { initNewMode(); return; }
      initEditMode(id);
    };
    if (window.NOVA_MONEY) {
      window.NOVA_MONEY.ready.then(boot).catch(boot);
    } else {
      boot();
    }
  });

  function initNewMode() {
    const featsEl = $('#ed-feats');
    const previewLink = $('#ed-preview');
    $('#ed-title').textContent = 'إضافة صفحة هبوط جديدة';
    $('#ed-code-id').textContent = 'لم تُنشأ بعد';
    previewLink.href = '../product.html';
    const resetBtn = $('#ed-reset');
    if (resetBtn) resetBtn.style.display = 'none';

    const data = {
      name: '', cat: '', headline: '', lead: '', desc: '', price: 0, old: null,
      tag: null, stock: 0, hue: '#e7ecf3', sku: '', material: '', origen: '',
      rating: 4.5, reviews: 0, sold: null, low30: true, images: [],
      reviewsArray: [], features: [], cta: 'Buy Now', ctaLink: '#add', active: true,
    };

    /* ---- Image rows ---- */
    function renderImageRows() {
      const wrap = $('#ed-images');
      wrap.innerHTML = '';
      if (!data.images.length) {
        const empty = document.createElement('div');
        empty.className = 'ed-empty';
        empty.textContent = 'لا توجد صور — اضغط "إضافة صورة" لرفعها من الجهاز أو وضع رابط.';
        wrap.appendChild(empty);
        return;
      }
      data.images.forEach((_, i) => addImageRow(i));
    }

    function addImageRow(index) {
      const wrap = $('#ed-images');
      const empty = wrap.querySelector('.ed-empty');
      if (empty) empty.remove();
      const row = document.createElement('div');
      row.className = 'ed-img-row';
      const src = data.images[index];
      row.innerHTML = `
        <input class="input ed-img-input" value="${esc(src)}" placeholder="رابط الصورة أو ارفع من الجهاز" dir="ltr" />
        <label class="ed-img-upload" title="رفع صورة من الجهاز">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 19 5-5 3 3 3-3 5 5"/></svg>
        </label>
        <button class="ed-img-del" type="button" aria-label="حذف الصورة">&times;</button>`;
      const input = row.querySelector('.ed-img-input');
      input.addEventListener('input', (e) => {
        data.images[index] = e.target.value.trim();
        refreshPreview();
      });
      row.querySelector('.ed-img-upload input[type=file]').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const btn = row.querySelector('.ed-img-upload');
        const prev = input.value;
        btn.classList.add('busy');
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/upload');
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.onload = () => {
            btn.classList.remove('busy');
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const r = JSON.parse(xhr.responseText);
                if (r.url) {
                  input.value = r.url;
                  data.images[index] = r.url;
                  refreshPreview();
                  if (prev && prev !== r.url) removeStoredImage(prev);
                } else { toast('خطأ: ' + (r.error || '')); }
              } catch (err) { toast('استجابة غير صالحة'); }
            } else {
              try { toast('فشل الرفع: ' + (JSON.parse(xhr.responseText).error || xhr.status)); }
              catch (err) { toast('فشل الرفع: ' + xhr.status); }
            }
          };
          xhr.onerror = () => { btn.classList.remove('busy'); toast('تعذر الاتصال'); };
          xhr.send(file);
          e.target.value = '';
        } catch (err) {
          btn.classList.remove('busy');
          console.error('[editor] upload failed to start:', err);
          toast('تعذر بدء الرفع');
        }
      });
      row.querySelector('.ed-img-del').addEventListener('click', () => {
        removeStoredImage(data.images[index]);
        data.images.splice(index, 1);
        renderImageRows();
        refreshPreview();
      });
      wrap.appendChild(row);
    }

    /* ---- Feature rows ---- */
    function renderFeatureRows() {
      featsEl.innerHTML = '';
      data.features.forEach((_, i) => addFeatureRow(i));
    }
    function addFeatureRow(index) {
      const row = document.createElement('div');
      row.className = 'ed-feat-row';
      row.innerHTML = `
        <input class="input f-feat" value="${esc(data.features[index])}" placeholder="ميزة المنتج..." />
        <button class="ed-feat-del" type="button" aria-label="حذف الميزة">&times;</button>`;
      row.querySelector('.f-feat').addEventListener('input', (e) => {
        data.features[index] = e.target.value.trim();
        refreshPreview();
      });
      row.querySelector('.ed-feat-del').addEventListener('click', () => {
        data.features.splice(index, 1);
        renderFeatureRows();
        refreshPreview();
      });
      featsEl.appendChild(row);
    }

    /* ---- Hybrid desc: WYSIWYG -> HTML sync ---- */
    function richTextHtml() {
      return descValue(true);
    }

    /* ---- Live preview ---- */
    function refreshPreview() {
      $('#pv-cat').textContent = data.cat || 'Producto';
      $('#pv-headline').textContent = data.headline || data.name || '—';
      $('#pv-price').innerHTML = data.old
        ? `<span class="old">${fmt(data.old)}</span>${fmt(data.price)}`
        : fmt(data.price);
      $('#pv-lead').textContent = data.lead || '';
      $('#pv-desc').innerHTML = data.desc || '';
      $('#pv-cta').textContent = data.cta || 'Buy Now';
      $('#pv-feats').innerHTML = (data.features || [])
        .map((f) => `<li>${esc(f)}</li>`).join('');
      $('#pv-meta').innerHTML =
        `<span>${esc(data.sku || 'NV-' + String(4).padStart(4, '0'))}</span>` +
        `<span>${esc(data.material || 'Grado premium')}</span>` +
        `<span>${esc(data.origen || 'Hecho en la UE')}</span>`;
      const t = document.querySelector('.edp-stars');
      const n = Math.max(1, Math.min(5, Math.round(Number(data.rating) || 5)));
      if (t) t.textContent = '★'.repeat(n) + '☆'.repeat(5 - n);
      $('#pv-revcount').textContent = (data.reviews || 0) + (data.sold ? ' · ' + data.sold + ' vendidos' : '');
    }

    function collect() {
      return {
        name: $('#f-name').value.trim(),
        cat: $('#f-cat').value.trim() || 'General',
        headline: $('#f-headline').value.trim(),
        lead: $('#f-lead').value.trim(),
        desc: richTextHtml(),
        price: Number($('#f-price').value) || 0,
        old: $('#f-old').value ? Number($('#f-old').value) : null,
        tag: $('#f-tag').value || null,
        stock: Number($('#f-stock').value) || 0,
        hue: $('#f-hue').value,
        sku: $('#f-sku').value.trim(),
        material: $('#f-material').value.trim(),
        origen: $('#f-origen').value.trim(),
        rating: $('#f-rating').value ? Number($('#f-rating').value) : 4.5,
        reviews: $('#f-reviews-count').value ? Number($('#f-reviews-count').value) : 0,
        sold: $('#f-sold').value ? Number($('#f-sold').value) : null,
        low30: $('#f-low30').checked,
        images: data.images.slice(),
        reviewsArray: data.reviewsArray.slice(),
        features: data.features,
        cta: $('#f-cta').value.trim() || 'Buy Now',
        ctaLink: $('#f-cta-link').value.trim() || '#add',
        active: $('#f-active').checked,
      };
    }

    const liveFields = ['#f-name', '#f-cat', '#f-headline', '#f-price', '#f-old', '#f-lead', '#f-cta',
      '#f-rating', '#f-reviews-count', '#f-sold', '#f-sku', '#f-material', '#f-origen'];
    liveFields.forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('input', refreshPreview);
    });
    $('#f-desc-rt').addEventListener('input', refreshPreview);
    const taInput1 = $('#f-desc-html');
    if (taInput1) taInput1.addEventListener('input', refreshPreview);
    $('#f-active').addEventListener('change', refreshPreview);
    $('#f-low30').addEventListener('change', refreshPreview);

    $('#ed-img-add').addEventListener('click', () => {
      data.images.push('');
      renderImageRows();
      refreshPreview();
    });
    $('#ed-feat-add').addEventListener('click', () => {
      data.features.push('');
      addFeatureRow(data.features.length - 1);
      refreshPreview();
    });
    initReviews(data);

    $('#ed-save').addEventListener('click', async () => {
      const r = collect();
      if (!r.name || r.price <= 0) { toast('أدخل اسم المنتج وسعراً صحيحاً أولاً'); return; }
      const body = Object.assign({}, r, { landing: {
        headline: r.headline, lead: r.lead, cta: r.cta, ctaLink: r.ctaLink, active: r.active,
      } });
      delete body.headline; delete body.lead; delete body.cta; delete body.ctaLink; delete body.active;
      try {
        const created = await apiSaveProduct(body);
        const trCount = await saveI18N(false).catch(() => null);
        const nid = Number(created.id);
        history.replaceState(null, '', 'product-editor.html?id=' + nid);
        $('#ed-title').textContent = 'تعديل صفحة الهبوط — ' + r.name;
        $('#ed-code-id').textContent = nid;
        previewLink.href = '../product.html?id=' + nid;
        const resetBtn2 = $('#ed-reset');
        if (resetBtn2) resetBtn2.style.display = '';
        toast(trCount ? 'تم إنشاء الصفحة وحفظ ' + trCount + ' ترجمة' : 'تم إنشاء صفحة الهبوط — يمكنك مواصلة التعديل');
        const saved = await apiGetProduct(nid);
        if (saved && saved.id) {
          data.name = saved.name;
          window.location.href = 'product-editor.html?id=' + nid + '&saved=1';
        }
      } catch (e) {
        toast('تعذر الإنشاء: ' + e.message);
      }
    });
  }

  function initEditMode(id) {

    const primary = window.NovaStore
      ? window.NovaStore.ready.then(() => apiGetProduct(id))
      : apiGetProduct(id);

    primary.catch(() => {
      const catalog = window.NovaStore ? window.NovaStore.catalog : [];
      const found = catalog.find((p) => p.id === id);
      if (found) return found;
      throw new Error('Not found');
    }).then((product) => {

      const featsEl = $('#ed-feats');
      const previewLink = $('#ed-preview');
      $('#ed-title').textContent = 'تعديل صفحة الهبوط — ' + product.name;
      $('#ed-code-id').textContent = id;
      previewLink.href = '../product.html?id=' + id;

      const landing = product.landing || {};
      const data = Object.assign({}, product, {
        headline: landing.headline || '',
        lead: landing.lead || '',
        cta: landing.cta || 'Buy Now',
        ctaLink: landing.ctaLink || '#add',
        active: landing.active !== false,
      });
      data.images = Array.isArray(data.images) ? data.images.slice() : [];
      data.reviewsArray = Array.isArray(data.reviewsArray) ? data.reviewsArray.slice() : [];

      /* ---- Populate fields ---- */
      $('#f-name').value = data.name || '';
      $('#f-cat').value = data.cat || '';
      $('#f-headline').value = data.headline || '';
      $('#f-price').value = data.price || '';
      $('#f-old').value = data.old || '';
      $('#f-tag').value = data.tag || '';
      $('#f-stock').value = data.stock == null ? '' : data.stock;
      $('#f-hue').value = data.hue || '#ffffff';
      $('#f-sku').value = data.sku || '';
      $('#f-material').value = data.material || '';
      $('#f-origen').value = data.origen || '';
      $('#f-rating').value = data.rating == null ? '' : data.rating;
      $('#f-reviews-count').value = data.reviews == null ? '' : data.reviews;
      $('#f-sold').value = data.sold == null ? '' : data.sold;
      $('#f-low30').checked = data.low30 !== false;
      $('#f-lead').value = data.lead || '';
      $('#f-desc-rt').innerHTML = data.desc || '';
      const taDesc = $('#f-desc-html');
      if (taDesc) taDesc.value = data.desc || '';
      $('#f-cta').value = data.cta || 'Buy Now';
      $('#f-cta-link').value = data.ctaLink || '#add';
      $('#f-active').checked = data.active !== false;

      function renderFeatureRows() {
        featsEl.innerHTML = '';
        const feats = (data.features && data.features.length ? data.features : []);
        data.features = feats.slice();
        feats.forEach((_, i) => addFeatureRow(i));
      }

      function addFeatureRow(index) {
        const row = document.createElement('div');
        row.className = 'ed-feat-row';
        row.innerHTML = `
          <input class="input f-feat" value="${esc(data.features[index])}" placeholder="ميزة المنتج..." />
          <button class="ed-feat-del" type="button" aria-label="حذف الميزة">&times;</button>`;
        row.querySelector('.f-feat').addEventListener('input', (e) => {
          data.features[index] = e.target.value.trim();
          refreshPreview();
        });
        row.querySelector('.ed-feat-del').addEventListener('click', () => {
          data.features.splice(index, 1);
          renderFeatureRows();
          refreshPreview();
        });
        featsEl.appendChild(row);
      }

      /* ---- Image rows ---- */
      function renderImageRows() {
        const wrap = $('#ed-images');
        wrap.innerHTML = '';
        if (!data.images.length) {
          const empty = document.createElement('div');
          empty.className = 'ed-empty';
          empty.textContent = 'لا توجد صور — اضغط "إضافة صورة" لرفعها من الجهاز أو وضع رابط.';
          wrap.appendChild(empty);
          return;
        }
        data.images.forEach((_, i) => addImageRow(i));
      }

      function addImageRow(index) {
        const wrap = $('#ed-images');
        const empty = wrap.querySelector('.ed-empty');
        if (empty) empty.remove();

        const row = document.createElement('div');
        row.className = 'ed-img-row';
        const src = data.images[index];
        row.innerHTML = `
          <input class="input ed-img-input" value="${esc(src)}" placeholder="رابط الصورة أو ارفع من الجهاز" dir="ltr" />
          <label class="ed-img-upload" title="رفع صورة من الجهاز">
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 19 5-5 3 3 3-3 5 5"/></svg>
          </label>
          <button class="ed-img-del" type="button" aria-label="حذف الصورة">&times;</button>`;
        const input = row.querySelector('.ed-img-input');
        input.addEventListener('input', (e) => {
          data.images[index] = e.target.value.trim();
        });
        row.querySelector('.ed-img-upload input[type=file]').addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          const btn = row.querySelector('.ed-img-upload');
          const prev = input.value;
          btn.classList.add('busy');
          try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/api/upload');
            xhr.setRequestHeader('Content-Type', file.type);
            xhr.onload = () => {
              btn.classList.remove('busy');
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  const r = JSON.parse(xhr.responseText);
                  if (r.url) {
                    input.value = r.url;
                    data.images[index] = r.url;
                    if (prev && prev !== r.url) removeStoredImage(prev);
                  } else { toast('خطأ: ' + (r.error || ''));
                  }
                } catch (err) { toast('استجابة غير صالحة'); }
              } else {
                try { toast('فشل الرفع: ' + (JSON.parse(xhr.responseText).error || xhr.status));
                } catch (err) { toast('فشل الرفع: ' + xhr.status); }
              }
            };
            xhr.onerror = () => { btn.classList.remove('busy'); toast('تعذر الاتصال'); };
            xhr.send(file);
            e.target.value = '';
          } catch (err) {
            btn.classList.remove('busy');
            console.error('[editor] upload failed to start:', err);
          toast('تعذر بدء الرفع');
          }
        });
        row.querySelector('.ed-img-del').addEventListener('click', () => {
          removeStoredImage(data.images[index]);
          data.images.splice(index, 1);
          renderImageRows();
        });
        wrap.appendChild(row);
      }

      /* ---- Review blocks (shared) ---- */
      initReviews(data);

      /* ---- Live preview ---- */
      function refreshPreview() {
        const r = collect();
        $('#pv-cat').textContent = data.cat;
        $('#pv-headline').textContent = r.headline || r.name || '—';
        $('#pv-price').innerHTML = `<span class="old">${r.old ? fmt(r.old) : ''}</span>${fmt(r.price)}`;
        $('#pv-lead').textContent = r.lead || '';
        $('#pv-desc').innerHTML = r.desc || '';
        $('#pv-cta').textContent = r.cta || 'Buy Now';
        $('#pv-feats').innerHTML = (r.features || [])
          .map((f) => `<li>${esc(f)}</li>`)
          .join('');
        const rvCount = r.reviewsArray && r.reviewsArray.length ? r.reviewsArray.length : (r.reviews || 0);
        $('#pv-revcount').textContent = rvCount + (rvCount === 1 ? ' مراجعة' : ' مراجعات') + ' · ' + (r.rating || '—') + ' ★';
        $('#pv-meta').textContent = [r.sku, r.material, r.origen].filter(Boolean).join(' · ') || 'SKU · Material · Origen';
      }

      function richTextHtml() {
        return descValue(true);
      }

      function collect() {
        return {
          name: $('#f-name').value.trim(),
          cat: $('#f-cat').value.trim() || 'General',
          headline: $('#f-headline').value.trim(),
          lead: $('#f-lead').value.trim(),
          desc: richTextHtml(),
          price: Number($('#f-price').value) || 0,
          old: $('#f-old').value ? Number($('#f-old').value) : null,
          tag: $('#f-tag').value || null,
          stock: Number($('#f-stock').value) || 0,
          hue: $('#f-hue').value,
          sku: $('#f-sku').value.trim(),
          material: $('#f-material').value.trim(),
          origen: $('#f-origen').value.trim(),
          rating: $('#f-rating').value ? Number($('#f-rating').value) : 4.5,
          reviews: $('#f-reviews-count').value ? Number($('#f-reviews-count').value) : 0,
          sold: $('#f-sold').value ? Number($('#f-sold').value) : null,
          low30: $('#f-low30').checked,
          images: data.images.slice(),
          reviewsArray: data.reviewsArray.slice(),
          features: data.features,
          cta: $('#f-cta').value.trim() || 'Buy Now',
          ctaLink: $('#f-cta-link').value.trim() || '#add',
          active: $('#f-active').checked,
        };
      }

      /* ---- Binding ---- */
      const liveFields = ['#f-name', '#f-headline', '#f-price', '#f-old', '#f-lead', '#f-cta',
        '#f-rating', '#f-reviews-count', '#f-sold', '#f-sku', '#f-material', '#f-origen'];
      liveFields.forEach((sel) => $(sel).addEventListener('input', refreshPreview));
$('#f-desc-rt').addEventListener('input', refreshPreview);
      const taInput2 = $('#f-desc-html');
      if (taInput2) taInput2.addEventListener('input', refreshPreview);

      /* ---- Rich text toolbar ---- */
      document.querySelectorAll('.ed-rt-btn[data-cmd]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cmd = btn.dataset.cmd;
          const rt = $('#f-desc-rt');
          rt.focus();
          if (cmd === 'createLink') {
            const url = prompt('أدخل رابط URL للرابط:');
            if (url) document.execCommand('createLink', false, url);
          } else if (cmd === 'unlink') {
            document.execCommand('unlink');
          } else if (cmd === 'formatBlock') {
            const tag = btn.dataset.val || 'h3';
            const current = document.queryCommandValue('formatBlock');
            document.execCommand('formatBlock', false, current && current.toLowerCase() === tag ? 'p' : tag);
          } else if (cmd === 'uploadImage' || cmd === 'uploadVideo') {
            // handled by the label's associated file input (change listener)
            return;
          } else {
            document.execCommand(cmd, false, null);
          }
          rt.dispatchEvent(new Event('input', { bubbles: true }));
          refreshPreview();
        });
      });
      $('#f-tag').addEventListener('change', refreshPreview);
      $('#f-stock').addEventListener('input', refreshPreview);
      $('#f-hue').addEventListener('input', refreshPreview);
      $('#f-low30').addEventListener('change', refreshPreview);

      $('#ed-feat-add').addEventListener('click', () => {
        data.features.push('');
        addFeatureRow(data.features.length - 1);
        refreshPreview();
      });

      $('#ed-img-add').addEventListener('click', () => {
        data.images.push('');
        addImageRow(data.images.length - 1);
      });

      $('#ed-save').addEventListener('click', async () => {
        const r = collect();
        const prevDesc = data.desc || '';
        const body = Object.assign({}, data, r, { id: Number(id), landing: {
          headline: r.headline,
          lead: r.lead,
          cta: r.cta,
          ctaLink: r.ctaLink,
          active: r.active,
        } });
        delete body.active;
        try {
          await apiSaveProduct(body);
          data.desc = r.desc || '';
          cleanupRemovedMedia(prevDesc, data.desc);
          const trCount = await saveI18N(false).catch(() => null);
          toast(trCount ? 'تم حفظ صفحة الهبوط و' + trCount + ' ترجمة — افتح المتجر لمشاهدة التغيير' : 'تم حفظ صفحة الهبوط — افتح المتجر لمشاهدة التغيير', 'success');
          updateI18nBadge();
          previewLink.href = '../product.html?id=' + id + '&v=' + Date.now();
        } catch (e) {
          toast('تعذر الحفظ: ' + e.message);
        }
      });

      $('#ed-reset').addEventListener('click', () => {
        toast('استعادة آخر نسخة محفوظة...');
        setTimeout(() => location.reload(), 350);
      });

      renderFeatureRows();
      renderImageRows();
      refreshPreview();
    }).catch(() => renderNotFound());
  }
})();