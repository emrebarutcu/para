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
        loginForm.setAttribute('hidden', '');
        loggedIn.removeAttribute('hidden');
        if (userEl) userEl.textContent = user.email;
      } else {
        loggedIn.setAttribute('hidden', '');
        loginForm.removeAttribute('hidden');
        if (msgEl) msgEl.textContent = '';
      }
    }

    function close() { modal.setAttribute('hidden', ''); }

    document.getElementById('authBtn')?.addEventListener('click', open);
    overlay?.addEventListener('click', close);
    document.getElementById('authClose')?.addEventListener('click', close);

    loginForm?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!db) return;
      const email = emailEl.value.trim();
      const btn = e.submitter;
      btn.disabled = true;
      btn.textContent = 'Gönderiliyor…';
      const { error } = await db.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      btn.disabled = false;
      btn.textContent = 'Link gönder';
      msgEl.textContent = error
        ? '⚠ ' + error.message
        : '✓ Link gönderildi — e-postanı kontrol et.';
      msgEl.style.color = error ? 'var(--expense)' : 'var(--income)';
    });

    logoutBtn?.addEventListener('click', async () => {
      await db?.auth.signOut();
      close();
    });
  });
})();
