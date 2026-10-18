// ---------- Cloud Sync (Supabase) ----------
(function () {
  let db = null;
  let user = null;
  let pushTimer = null;
  let onRemoteDataCb = null;
  let onSyncedCb = null;
  let inboxChannel = null;
  let dataChannel = null;

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
    onSyncedCb = callbacks.onSynced;
    if (!enabled()) { renderBtn(null); return; }

    db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

    db.auth.getSession().then(({ data }) => {
      user = data.session?.user ?? null;
      renderBtn(user);
      if (user) { refresh(); watchInbox(); watchData(); }
    });

    db.auth.onAuthStateChange((event, session) => {
      user = session?.user ?? null;
      window.CF_USER_ID = user?.id || null;
      renderBtn(user);
      if (event === 'SIGNED_IN') {
        if (typeof window.onAuthLogin === 'function') window.onAuthLogin(user.id);
        refresh();
        watchInbox();
        watchData();
      }
      if (event === 'SIGNED_OUT') {
        unwatchInbox();
        unwatchData();
        if (typeof window.onAuthLogout === 'function') window.onAuthLogout();
      }
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

  // Uygulama öne gelince: başka cihazdaki değişiklikler ve yeni e-postalar
  window.syncRefresh = function () {
    if (db && user) return refresh();
  };

  // ── E-postadan harcama (supabase/eposta.sql) ────────────────────────────────
  // İşlenmemiş e-postalar; tablo yoksa ya da hata olursa null
  window.syncInboxFetch = async function () {
    if (!db || !user) return null;
    const { data, error } = await db.from('inbox_messages')
      .select('id, sender, subject, body, received_at')
      .is('processed_at', null)
      .order('received_at')
      .limit(50);
    return error ? null : data;
  };

  // E-postaları işlendi olarak işaretler ve işaretlenenlerin id'lerini döndürür.
  // Başka bir cihaz aynı e-postayı önce işlediyse o id dönmez — harcama iki kez eklenmez.
  window.syncInboxClaim = async function (ids) {
    if (!db || !user || !ids.length) return [];
    const { data, error } = await db.from('inbox_messages')
      .update({ processed_at: new Date().toISOString() })
      .in('id', ids)
      .is('processed_at', null)
      .select('id');
    return error ? [] : data.map(r => r.id);
  };

  // Kullanıcının e-posta adresi ("<address>@INBOX_DOMAIN"); yoksa (ya da renew ile) yenisi oluşturulur
  window.syncInboxAddress = async function (renew) {
    if (!db || !user) return null;
    if (renew) {
      const { error } = await db.from('inbox_addresses').delete().eq('user_id', user.id);
      if (error) throw error;
    } else {
      const { data, error } = await db.from('inbox_addresses').select('address').eq('user_id', user.id).maybeSingle();
      if (error) throw error;
      if (data) return data.address;
    }
    const { data, error } = await db.from('inbox_addresses').insert({ user_id: user.id }).select('address').single();
    if (error) throw error;
    return data.address;
  };

  // Uygulama açıkken gelen e-posta beklemeden işlensin
  function watchInbox() {
    unwatchInbox();
    if (!db || !user || typeof db.channel !== 'function') return;
    inboxChannel = db.channel('inbox-' + user.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inbox_messages', filter: `user_id=eq.${user.id}` },
        () => { if (typeof onSyncedCb === 'function') onSyncedCb(); })
      .subscribe();
  }

  function unwatchInbox() {
    if (inboxChannel) db.removeChannel(inboxChannel);
    inboxChannel = null;
  }

  // ── Yapay zekâ asistanları (Supabase OAuth 2.1 → /mcp) ─────────────────────
  // Kullanıcının izin verdiği uygulamalar; OAuth sunucusu kapalıysa ya da hata olursa null
  window.syncOAuthGrants = async function () {
    if (!db || !user || !db.auth.oauth?.listGrants) return null;
    const { data, error } = await db.auth.oauth.listGrants();
    return error ? null : data;
  };

  // İzni kaldırır: uygulamanın oturumları ve yenileme token'ları geçersiz olur
  window.syncOAuthRevoke = async function (clientId) {
    const { error } = await db.auth.oauth.revokeGrant({ clientId });
    if (error) throw error;
  };

  // Asistan (MCP) ya da başka cihaz veriyi değiştirince açık uygulama beklemeden güncellensin
  // (supabase/mcp.sql: cashflow_data Realtime yayınında). Kendi yazdığımız veri _v'den dolayı yok sayılır.
  function watchData() {
    unwatchData();
    if (!db || !user || typeof db.channel !== 'function') return;
    dataChannel = db.channel('data-' + user.id)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'cashflow_data', filter: `user_id=eq.${user.id}` },
        () => pull())
      .subscribe();
  }

  function unwatchData() {
    if (dataChannel) db.removeChannel(dataChannel);
    dataChannel = null;
  }

  // ── Internal ────────────────────────────────────────────────────────────────
  // Önce uzak veri çekilir, sonra e-postalar işlenir: harcama güncel verinin üstüne eklensin
  async function refresh() {
    await pull();
    if (typeof onSyncedCb === 'function') onSyncedCb();
  }

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
