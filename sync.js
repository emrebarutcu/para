// ---------- Cloud Sync (Supabase) ----------
// Global scope — no modules needed. Exposes: syncInit, syncSchedulePush, syncGetUser

(function () {
  let db = null;
  let user = null;
  let pushTimer = null;
  let onRemoteDataCb = null;

  function enabled() {
    return !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  window.syncInit = function (callbacks) {
    onRemoteDataCb = callbacks.onRemoteData;
    if (!enabled()) { renderBtn(null); return; }

    db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

    // Detect magic-link redirect
    db.auth.getSession().then(({ data }) => {
      user = data.session?.user ?? null;
      renderBtn(user);
      if (user) pull();
    });

    db.auth.onAuthStateChange((event, session) => {
      user = session?.user ?? null;
      renderBtn(user);
      if (event === 'SIGNED_IN') pull();
      if (event === 'PASSWORD_RECOVERY') showResetForm();
    });
  };

  window.syncSchedulePush = function (stateData) {
    if (!db || !user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      db.from('cashflow_data').upsert(
        { user_id: user.id, data: stateData, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    }, 1500);
  };

  window.syncGetUser = function () { return user; };

  // ── Internal ────────────────────────────────────────────────────────────────

  async function pull() {
    if (!db || !user) return;
    const { data } = await db
      .from('cashflow_data')
      .select('data')
      .eq('user_id', user.id)
      .single();
    if (data?.data && typeof onRemoteDataCb === 'function') {
      onRemoteDataCb(data.data);
    }
  }

  function renderBtn(u) {
    const btn = document.getElementById('authBtn');
    if (!btn) return;
    if (!enabled()) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.textContent = u ? ('☁ ' + (u.email.split('@')[0])) : '☁ Giriş';
    btn.title = u ? u.email : 'Cloud sync için giriş yap';
    btn.classList.toggle('auth-active', !!u);
  }

  // ── Auth modal ──────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    const modal     = document.getElementById('authModal');
    const overlay   = document.getElementById('authOverlay');
    const loginForm = document.getElementById('authLoginForm');
    const loggedIn  = document.getElementById('authLoggedIn');
    const emailEl   = document.getElementById('authEmail');
    const msgEl     = document.getElementById('authMsg');
    const userEl    = document.getElementById('authUserEmail');
    const logoutBtn = document.getElementById('authLogoutBtn');

    function open() {
      modal.removeAttribute('hidden');
      if (user) {
        showView('authLoggedIn');
        if (userEl) userEl.textContent = user.email;
      } else {
        showView('authLoginForm');
        if (msgEl) msgEl.textContent = '';
      }
    }

    function close() { modal.setAttribute('hidden', ''); }

    function showView(id) {
      ['authLoginForm','authForgotForm','authResetForm','authLoggedIn'].forEach(v => {
        document.getElementById(v)?.[v === id ? 'removeAttribute' : 'setAttribute']('hidden', '');
      });
    }

    function showResetForm() {
      document.getElementById('authModal').removeAttribute('hidden');
      showView('authResetForm');
    }

    document.getElementById('authBtn')?.addEventListener('click', open);
    overlay?.addEventListener('click', close);
    document.getElementById('authClose')?.addEventListener('click', close);

    document.getElementById('forgotBtn')?.addEventListener('click', () => {
      document.getElementById('forgotEmail').value = document.getElementById('authEmail')?.value || '';
      document.getElementById('forgotMsg').textContent = '';
      showView('authForgotForm');
    });

    document.getElementById('backToLoginBtn')?.addEventListener('click', () => showView('authLoginForm'));

    document.getElementById('forgotForm')?.addEventListener('submit', async e => {
      e.preventDefault();
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

    document.getElementById('resetForm')?.addEventListener('submit', async e => {
      e.preventDefault();
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
        setTimeout(close, 1200);
      }
    });

    // Tab switching
    let authMode = 'login';
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        authMode = tab.dataset.tab;
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.getElementById('authSubmitBtn').textContent = authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol';
        document.getElementById('authPassword').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
        if (msgEl) msgEl.textContent = '';
      });
    });

    document.getElementById('authForm')?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!db) return;
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      const btn = e.submitter;
      btn.disabled = true;
      btn.textContent = '…';

      let error;
      if (authMode === 'login') {
        ({ error } = await db.auth.signInWithPassword({ email, password }));
      } else {
        ({ error } = await db.auth.signUp({ email, password }));
      }

      btn.disabled = false;
      btn.textContent = authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol';

      if (error) {
        msgEl.textContent = '⚠ ' + (error.message === 'Invalid login credentials' ? 'E-posta veya şifre hatalı.' : error.message);
        msgEl.style.color = 'var(--expense)';
      } else if (authMode === 'register') {
        msgEl.textContent = '✓ Kayıt olundu! Giriş yapılıyor…';
        msgEl.style.color = 'var(--income)';
      } else {
        close();
      }
    });

    logoutBtn?.addEventListener('click', async () => {
      await db?.auth.signOut();
      close();
    });
  });
})();
