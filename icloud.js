// ---------- iCloud Sync (CloudKit JS) ----------
// Veriler kullanıcının iCloud hesabındaki özel veritabanında tek bir kayıtta tutulur
// (kayıt türü ParaState, kayıt adı "para-state"); iCloud depolama kotasından düşer.
// config.js'te ICLOUD_CONTAINER ve ICLOUD_API_TOKEN boşsa bu modül hiçbir şey göstermez.
(function () {
  const SDK_URL = "https://cdn.apple-cloudkit.com/ck/2/cloudkit.js";
  const RECORD_NAME = "para-state";
  const RECORD_TYPE = "ParaState";
  const LINK_KEY = "para.icloud.linked";   // bu cihazda ilk eşitlemesi yapılmış iCloud kullanıcısı

  let container = null;
  let db = null;
  let user = null;
  let changeTag = null;
  let cb = null;
  let pushTimer = 0;
  let queue = Promise.resolve();
  let status = "off";         // off | loading | signedOut | signedIn | error
  let ready = false;          // ilk eşitleme bitti mi — bitmeden yazılmaz, iCloud'daki veri ezilmesin
  let lastSync = null;
  let lastError = "";

  function configured() {
    return !!(window.ICLOUD_CONTAINER && window.ICLOUD_API_TOKEN);
  }

  function active() {
    return status === "signedIn" && ready;
  }

  // Oturum açık ama ilk eşitleme bitmemişse (ör. ağ hatası) yazmadan önce o
  function ensureSynced() {
    if (status !== "signedIn") return false;
    if (!ready) { run(firstSync); return false; }
    return true;
  }

  function readPref(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }

  function loadSdk() {
    if (window.CloudKit) return Promise.resolve(window.CloudKit);
    return new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement("script"), { src: SDK_URL, async: true });
      s.onload = () => (window.CloudKit
        ? resolve(window.CloudKit)
        : document.addEventListener("cloudkitloaded", () => resolve(window.CloudKit), { once: true }));
      s.onerror = () => { s.remove(); reject(new Error("CloudKit yüklenemedi")); };
      document.head.append(s);
    });
  }

  function errorText(err) {
    return err?.reason || err?.serverErrorCode || err?.ckErrorCode || err?.message || String(err);
  }

  // ── Kayıt okuma / yazma ──────────────────────────────────────────────────
  async function fetchRemote() {
    let res;
    try {
      res = await db.fetchRecords([RECORD_NAME]);
    } catch (err) {
      if (err?.ckErrorCode === "NOT_FOUND") { changeTag = null; return null; }
      throw err;
    }
    if (res.hasErrors) {
      const err = res.errors[0];
      if (err.ckErrorCode === "NOT_FOUND") { changeTag = null; return null; }
      throw err;
    }
    const rec = res.records[0];
    changeTag = rec.recordChangeTag;
    return { state: JSON.parse(rec.fields.data.value), modified: rec.modified?.timestamp ?? null };
  }

  async function save(state, retried = false) {
    const record = {
      recordType: RECORD_TYPE,
      recordName: RECORD_NAME,
      fields: {
        data: { value: JSON.stringify(state) },
        version: { value: state._v || 0 },
      },
    };
    if (changeTag) record.recordChangeTag = changeTag;
    const res = await db.saveRecords([record]);
    if (res.hasErrors) {
      const err = res.errors[0];
      // Başka bir cihaz araya yazdı: sunucudaki daha yeniyse onu al, değilse yeni etiketle tekrar yaz
      if (!retried && err.ckErrorCode === "CONFLICT") {
        const remote = await fetchRemote();
        if (remote && (remote.state._v || 0) > (state._v || 0)) { cb.onRemoteData(remote.state); return; }
        return save(state, true);
      }
      throw err;
    }
    changeTag = res.records[0].recordChangeTag;
    lastSync = new Date();
    renderRow();
  }

  // İşlemler sırayla yürür; hatalar satırda gösterilir
  function run(task) {
    queue = queue.then(task).catch(err => {
      if (err?.ckErrorCode === "AUTHENTICATION_REQUIRED") { signedOut(); return; }
      lastError = errorText(err);
      renderRow();
    });
    return queue;
  }

  // Bağlandıktan sonraki ilk eşitleme. Bu cihaz bu iCloud hesabıyla ilk kez eşitleniyorsa ve iki
  // tarafta da farklı veri varsa kullanıcıya sorulur; sonrası "son yazan kazanır" (_v).
  async function firstSync() {
    const remote = await fetchRemote();
    const local = cb.getState();
    const linked = readPref(LINK_KEY) === user.userRecordName;

    if (!remote) {
      await save(local);
    } else if (!linked && !cb.isEmpty(local) && !sameData(remote.state, local)) {
      const when = remote.modified ? new Date(remote.modified).toLocaleString("tr-TR") : "bilinmiyor";
      const useRemote = confirm(
        `iCloud'da kayıtlı verilerin var (son güncelleme: ${when}).\n\n` +
        "Bu cihazdakilerin yerine iCloud'dakileri kullanalım mı?\n" +
        "İptal dersen bu cihazdaki veriler iCloud'a yüklenir.");
      if (useRemote) cb.onRemoteData(remote.state, { force: true });
      else await save({ ...local, _v: Math.max(local._v || 0, (remote.state._v || 0) + 1) });
    } else if (!linked || (remote.state._v || 0) > (local._v || 0)) {
      cb.onRemoteData(remote.state, { force: !linked });
    } else if ((local._v || 0) > (remote.state._v || 0)) {
      await save(local);
    }
    writePref(LINK_KEY, user.userRecordName);
    ready = true;
    lastSync = new Date();
    lastError = "";
    renderRow();
  }

  function sameData(a, b) {
    const strip = ({ _v, ...rest }) => JSON.stringify(rest);
    return strip(a) === strip(b);
  }

  // Başka cihazdaki değişiklikleri almak için: uygulama öne geldiğinde
  async function pull() {
    const remote = await fetchRemote();
    if (remote) cb.onRemoteData(remote.state);
    lastSync = new Date();
    renderRow();
  }

  // ── Oturum ───────────────────────────────────────────────────────────────
  function signedIn(identity) {
    user = identity;
    status = "signedIn";
    ready = false;
    lastError = "";
    renderRow();
    container.whenUserSignsOut().then(signedOut);
    run(firstSync);
  }

  function signedOut(err) {
    user = null;
    changeTag = null;
    ready = false;
    status = "signedOut";
    lastError = err && err.ckErrorCode !== "AUTH_PERSIST_ERROR" ? errorText(err) : "";
    renderRow();
    container.whenUserSignsIn().then(signedIn).catch(signedOut);
  }

  // ── Arayüz (ayarlardaki iCloud satırı) ───────────────────────────────────
  function renderRow() {
    const group = document.getElementById("cloudGroup");
    if (!group) return;
    group.hidden = !configured();
    const text = document.getElementById("icloudStatus");
    const signInSlot = document.getElementById("ck-sign-in");
    const signOutBtn = document.getElementById("icloudSignOut");

    let msg;
    if (status === "loading") msg = "Bağlanıyor…";
    else if (status === "signedIn") {
      const name = user?.nameComponents
        ? [user.nameComponents.givenName, user.nameComponents.familyName].filter(Boolean).join(" ")
        : "";
      msg = `Bağlı${name ? ": " + name : ""}`;
      if (lastSync) msg += ` · son eşitleme ${lastSync.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
    } else if (status === "signedOut") msg = "Apple hesabınla bağlan; verilerin iCloud'unda saklanır";
    else if (status === "error") msg = "iCloud'a bağlanılamadı";
    else msg = "Verilerin iCloud hesabında saklanır";
    if (lastError) msg += ` — ${lastError}`;
    if (text) text.textContent = msg;

    if (signInSlot) signInSlot.hidden = status !== "signedOut";
    if (signOutBtn) signOutBtn.hidden = status !== "signedIn";
  }

  // ── Public API (app.js PARA_SYNC üzerinden çağırır) ─────────────────────
  async function init(callbacks) {
    cb = callbacks;
    renderRow();
    if (!configured()) return;

    document.getElementById("icloudSignOut")?.addEventListener("click", () => container?.signOut());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && active()) run(pull);
    });

    status = "loading";
    renderRow();
    try {
      const CloudKit = await loadSdk();
      const dark = document.documentElement.dataset.theme === "dark"
        || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      CloudKit.configure({
        locale: "tr-tr",
        containers: [{
          containerIdentifier: window.ICLOUD_CONTAINER,
          apiTokenAuth: {
            apiToken: window.ICLOUD_API_TOKEN,
            persist: true,
            signInButton: { id: "ck-sign-in", theme: dark ? "white" : "black" },
            signOutButton: { id: "ck-sign-out", theme: "black" },
          },
          environment: window.ICLOUD_ENV === "development" ? "development" : "production",
        }],
      });
      container = CloudKit.getDefaultContainer();
      db = container.privateCloudDatabase;
      const identity = await container.setUpAuth();
      identity ? signedIn(identity) : signedOut();
    } catch (err) {
      status = "error";
      lastError = errorText(err);
      renderRow();
    }
  }

  function schedulePush(state) {
    if (!ensureSynced()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => run(() => save(state)), 1500);
  }

  function pushNow(state) {
    if (!ensureSynced()) return queue;
    clearTimeout(pushTimer);
    return run(() => save(state));
  }

  (window.PARA_SYNC = window.PARA_SYNC || []).push({ id: "icloud", init, schedulePush, pushNow });
})();
