/* =========================================================
   NOVA — Admin login page (Supabase Auth, email + password)
   Sign in only — the admin account is created during migration
   (admin@nova-store.com) and authenticated against Supabase Auth.
   ========================================================= */
(function () {
  'use strict';

  const form = document.getElementById('login-form');
  const title = document.getElementById('login-title');
  const sub = document.getElementById('login-sub');
  const errorEl = document.getElementById('login-error');
  const emailInput = document.getElementById('lg-code');
  const passInput = document.getElementById('lg-pass');
  const btn = document.getElementById('login-btn');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'تسجيل الدخول';
  }

  function configureEmailField() {
    if (!emailInput) return;
    emailInput.type = 'email';
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'admin@nuestra-tienda.com';
    emailInput.setAttribute('required', 'required');
    const wrap = emailInput.closest('.login-field');
    if (wrap) {
      const span = wrap.querySelector('span');
      if (span) span.textContent = 'البريد الإلكتروني';
    }
  }

  async function applyStatus() {
    try {
      const res = await fetch('/api/auth/status', { cache: 'no-store' });
      const st = await res.json();
      if (st.loggedIn) {
        location.href = '/admin';
        return;
      }
      title.textContent = 'تسجيل الدخول';
      sub.textContent = 'أدخل البريد الإلكتروني وكلمة السر الخاصة بالمتجر.';
      configureEmailField();
      try {
        const s = await fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json());
        const storeName = (s && s.storeName && String(s.storeName).trim()) || '';
        if (storeName) document.querySelector('.login-name').textContent = storeName;
      } catch (e) { /* keep NOVA */ }
    } catch (e) {
      showError('تعذر الاتصال بالخادم. أعد المحاولة.');
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    const email = emailInput.value.trim();
    const password = passInput.value;
    if (!email || !password) {
      showError('أدخل البريد الإلكتروني وكلمة السر.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول…';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password }),
      });
      const data = await res.json();
      if (res.ok) {
        location.href = '/admin';
      } else {
        showError(data.error || 'حدث خطأ غير متوقع.');
      }
    } catch (err) {
      showError('تعذر الاتصال بالخادم. أعد المحاولة.');
    }
  });

  applyStatus();
})();