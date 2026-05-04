// ---------- Cloud Sync (Supabase) ----------
(function () {
  let db = null;
  let user = null;
  let pushTimer = null;
  let onRemoteDataCb = null;

  function enabled() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase);
  }

  // ── Modal helpers — IIFE scope so onAuthStateChange can reach them ──────────
  function showView(id) {
    ['authLoginForm','authForgotForm','authResetForm','authLoggedIn'].forEach(v => {
      const el = document.getElementById(v);
      if (el) v === id ? el.removeAttribute('hidden') : el.setAttribute('hidden', '');
    });
  }

  function openModal() {
    const modal = document.getElementById('authModal');
    if (!modal) return;
    modal.removeAttribute('hidden');
    if (user) {
      showView('authLoggedIn');
      const el = document.getElementById('authUserEmail');
      if (el) el.textContent = user.email;
    } else {
      showView('authLoginForm');
      const el = document.getElementById('authMsg');
      if (el) el.textContent = '';
    }
  }

  function closeModal() {
    document.getElementById('authModal')?.setAttribute('hidden', '');
  }

  function showResetForm() {
    document.getElementById('authModal')?.removeAttribute('hidden');
    showView('authResetForm');
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  window.syncInit = function (callbacks) {
    onRemoteDataCb = callbacks.onRemoteData;
    if (!enabled()) { renderBtn(null); return; }

    db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

    db.auth.getSession().then(({ data }) => {
      user = data.session?.user ?? null;
      renderBtn(user);
      if (user) pull();
    });

    db.auth.onAuthStateChange((event, session) => {
      user = session?.user ?? null;
      renderBtn(user);
      if (event === 'SIGNED_IN')         pull();
      if (event === 'PASSWORD_RECOVERY') showResetForm();
    });
  };

  window.syncSchedulePush = function (stateData) {
    if (!db || !user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push(stateData), 1500);
  };

  window.syncPushNow = async function (stateData) {
    if (!db || !user) return;
    clearTimeout(pushTimer);
    await push(stateData);
  };

  async function push(stateData) {
    await db.from('cashflow_data').upsert(
      { user_id: user.id, data: stateData, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  }

  window.syncGetUser = function () { return user; };

  // ── Internal ────────────────────────────────────────────────────────────────
  async function pull() {
    if (!db || !user) return;
    const { data } = await db.from('cashflow_data').select('data').eq('user_id', user.id).single();
    if (data?.data && typeof onRemoteDataCb === 'function') onRemoteDataCb(data.data);
  }

  function renderBtn(u) {
    const btn = document.getElementById('authBtn');
    if (!btn) return;
    if (!enabled()) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.textContent = u ? ('☁ ' + u.email.split('@')[0]) : '☁ Giriş';
    btn.title = u ? u.email : 'Cloud sync için giriş yap';
    btn.classList.toggle('auth-active', !!u);
  }

  // ── Event wiring ────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    let authMode = 'login';

    document.getElementById('authBtn')?.addEventListener('click', openModal);
    document.getElementById('authOverlay')?.addEventListener('click', closeModal);
    document.getElementById('authClose')?.addEventListener('click', closeModal);

    // Giriş / Kayıt tabs
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        authMode = tab.dataset.tab;
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.getElementById('authSubmitBtn').textContent = authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol';
        document.getElementById('authPassword').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
        const m = document.getElementById('authMsg'); if (m) m.textContent = '';
      });
    });

    // Giriş / Kayıt form
    document.getElementById('authForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!db) return;
      const email    = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      const btn = e.submitter;
      btn.disabled = true; btn.textContent = '…';

      const { error } = authMode === 'login'
        ? await db.auth.signInWithPassword({ email, password })
        : await db.auth.signUp({ email, password });

      btn.disabled = false;
      btn.textContent = authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol';

      const msgEl = document.getElementById('authMsg');
      if (error) {
        msgEl.textContent = '⚠ ' + (error.message === 'Invalid login credentials' ? 'E-posta veya şifre hatalı.' : error.message);
        msgEl.style.color = 'var(--expense)';
      } else if (authMode === 'register') {
        msgEl.textContent = '✓ Kayıt olundu!';
        msgEl.style.color = 'var(--income)';
      } else {
        closeModal();
      }
    });

    // Şifremi unuttum
    document.getElementById('forgotBtn')?.addEventListener('click', () => {
      const email = document.getElementById('authEmail')?.value || '';
      const fi = document.getElementById('forgotEmail'); if (fi) fi.value = email;
      const fm = document.getElementById('forgotMsg');  if (fm) fm.textContent = '';
      showView('authForgotForm');
    });
    document.getElementById('backToLoginBtn')?.addEventListener('click', () => showView('authLoginForm'));

    document.getElementById('forgotForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!db) return;
      const email = document.getElementById('forgotEmail').value.trim();
      const btn = e.submitter;
      btn.disabled = true; btn.textContent = '…';
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      btn.disabled = false; btn.textContent = 'Link gönder';
      const msgEl = document.getElementById('forgotMsg');
      msgEl.textContent = error ? '⚠ ' + error.message : '✓ Link gönderildi — e-postanı kontrol et.';
      msgEl.style.color = error ? 'var(--expense)' : 'var(--income)';
    });

    // Yeni şifre belirle
    document.getElementById('resetForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!db) return;
      const password = document.getElementById('newPassword').value;
      const btn = e.submitter;
      btn.disabled = true; btn.textContent = '…';
      const { error } = await db.auth.updateUser({ password });
      btn.disabled = false; btn.textContent = 'Şifreyi güncelle';
      const msgEl = document.getElementById('resetMsg');
      if (error) {
        msgEl.textContent = '⚠ ' + error.message;
        msgEl.style.color = 'var(--expense)';
      } else {
        msgEl.textContent = '✓ Şifre güncellendi!';
        msgEl.style.color = 'var(--income)';
        setTimeout(closeModal, 1200);
      }
    });

    // Çıkış
    document.getElementById('authLogoutBtn')?.addEventListener('click', async () => {
      await db?.auth.signOut();
      closeModal();
    });
  });
})();
