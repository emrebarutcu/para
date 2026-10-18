// ---------- Yapay zekâ uygulamasına erişim izni (Supabase OAuth 2.1) ----------
// MCP istemcisi kullanıcıyı Supabase'in yetkilendirme adresine yollar; Supabase de buraya
// ?authorization_id=… ile yönlendirir. Kullanıcı giriş yapıp izin verince istemciye kod ile dönülür.
(function () {
  const $ = id => document.getElementById(id);
  const VIEWS = ["consentLoading", "consentLogin", "consentAsk", "consentError"];
  const authorizationId = new URLSearchParams(location.search).get("authorization_id");
  let db = null;

  function show(id) {
    for (const v of VIEWS) $(v).hidden = v !== id;
  }

  function showError(message) {
    $("consentErrorMsg").textContent = message;
    show("consentError");
  }

  function hostOf(uri) {
    try { return new URL(uri).host || uri; } catch { return uri || "—"; }
  }

  async function loadDetails() {
    show("consentLoading");
    const { data, error } = await db.auth.oauth.getAuthorizationDetails(authorizationId);
    if (error || !data) {
      showError(error?.message === "Auth session missing!" ? "Oturum bulunamadı, yeniden giriş yap." : "İstek geçersiz ya da süresi dolmuş. Bağlantıyı yapay zekâ uygulamasından yeniden başlat.");
      return;
    }
    // Daha önce izin verilmiş: istemciye doğrudan dönülür
    if (!data.authorization_id && data.redirect_url) { location.assign(data.redirect_url); return; }
    $("consentClient").textContent = data.client?.name || "Bir uygulama";
    $("consentEmail").textContent = data.user?.email || "";
    $("consentRedirect").textContent = hostOf(data.redirect_uri);
    show("consentAsk");
  }

  async function decide(approve) {
    for (const b of [$("consentApprove"), $("consentDeny")]) b.disabled = true;
    const fn = approve ? db.auth.oauth.approveAuthorization : db.auth.oauth.denyAuthorization;
    const { data, error } = await fn.call(db.auth.oauth, authorizationId, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) {
      showError(error?.message || "İzin kaydedilemedi. Yeniden dene.");
      return;
    }
    location.assign(data.redirect_url);
  }

  async function start() {
    if (!authorizationId) { showError("Yetkilendirme isteği bulunamadı. Bağlantıyı yapay zekâ uygulamasından başlat."); return; }
    if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY || !window.supabase) { showError("Bulut hesabı bu kurulumda kapalı."); return; }
    db = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    if (!db.auth.oauth?.getAuthorizationDetails) { showError("Tarayıcı kitaplığı güncel değil; sayfayı yenile."); return; }
    const { data } = await db.auth.getSession();
    if (data.session) await loadDetails();
    else show("consentLogin");
  }

  $("consentLoginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    const { error } = await db.auth.signInWithPassword({
      email: $("consentEmailInput").value.trim(),
      password: $("consentPassword").value,
    });
    btn.disabled = false;
    if (error) {
      const msg = $("consentLoginMsg");
      msg.textContent = "⚠ " + (error.message === "Invalid login credentials" ? "E-posta veya şifre hatalı." : error.message);
      msg.style.color = "var(--expense)";
      return;
    }
    await loadDetails();
  });

  $("consentApprove").addEventListener("click", () => decide(true));
  $("consentDeny").addEventListener("click", () => decide(false));
  $("consentSwitch").addEventListener("click", async () => {
    await db.auth.signOut();
    show("consentLogin");
  });

  start().catch(() => showError("Beklenmeyen bir hata oldu. Sayfayı yenile."));
})();
