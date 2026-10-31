// ---------- iOS köprüsü: uygulamanın JavaScriptCore'da çalışan çekirdeği ----------
// iOS uygulaması (ios/CashFollow) hesap ve doğrulama kurallarını yeniden yazmaz: web'in DOM'dan bağımsız modüllerini
// (tekrar, taksit, varlik, borc, kategori, eposta, icgoru, tablo) ve asistanların araçlarını (mcp/tools.js) olduğu gibi
// çalıştırır. Ekranlar araçları çağırır (get_overview, list_cards, add_purchase…); veri, eşitleme tabanı ve ağ Swift'tedir.
// Yükleme sırası (Motor.swift): tekrar, taksit, varlik, borc, kategori, eposta, icgoru, tablo, kopru; sonra
// Kopru.loadTools(mcp/tools.js'in metni).
//
// Swift'in verdiği yerel işlevler (globalThis.native):
//   native.load()          → kayıtlı verinin JSON'u (yoksa "")
//   native.save(json)      veriyi kaydeder (araç değiştirdiyse)
//   native.random(n)       → n rastgele bayt (dizi)
//   native.log(level, msg)
(function (root) {
  const T = root.Taksit, V = root.Varlik, K = root.Kategori, Tablo = root.Tablo;

  // JavaScriptCore'da console ve crypto yoktur
  const say = level => (...args) => {
    const msg = args.map(a => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
    if (root.native?.log) root.native.log(level, msg);
  };
  if (!root.console) root.console = { log: say("log"), info: say("log"), warn: say("warn"), error: say("error"), debug: say("log") };
  if (!root.crypto?.getRandomValues) {
    root.crypto = {
      getRandomValues(a) {
        const bytes = root.native?.random ? root.native.random(a.length) : null;
        for (let i = 0; i < a.length; i++) a[i] = bytes ? bytes[i] : Math.floor(Math.random() * 256);
        return a;
      },
    };
  }

  // mcp/tools.js bir ES modülüdür (import / export); JavaScriptCore'un düz betiğine çevrilir. İçe aktardığı modüller
  // yukarıda yüklenmiş genel nesnelerdir.
  const GLOBALS = { taksit: "Taksit", eposta: "Eposta", varlik: "Varlik", tekrar: "Tekrar", kategori: "Kategori", icgoru: "Icgoru", borc: "Borc", tablo: "Tablo" };
  function toScript(src) {
    const body = String(src)
      .replace(/^import\s+(\w+)\s+from\s+"\.\.\/(\w+)\.js";?\s*$/gm, (line, name, file) => {
        if (!GLOBALS[file]) throw new Error(`kopru: bilinmeyen modül ${file}.js`);
        return `const ${name} = globalThis.${GLOBALS[file]};`;
      })
      .replace(/^export\s+(?=(?:async\s+)?(?:const|let|function|class)\s)/gm, "");
    if (/^\s*(import|export)\s/m.test(body)) throw new Error("kopru: çevrilemeyen import / export");
    return body;
  }

  let tools = null;   // { TOOLS, ToolError, todayKey }
  function loadTools(src) {
    const body = toScript(src);
    // eslint-disable-next-line no-new-func
    tools = new Function(`"use strict";\n${body}\nreturn { TOOLS, ToolError, todayKey, TIME_ZONE };`)();
    return tools.TOOLS.map(t => t.name);
  }

  // ── Kurlar ve fiyatlar: Swift önceden çeker (cashfollow.app/api/kur, /api/fiyat), araç çağrısında hazırdır ──
  let rates = null;                    // { rates: { TRY, USD, EUR, GAU }, updatedAt, source }
  let prices = {};                     // "BIST:THYAO" → { price, … }
  let pricesFailed = [];               // fiyatı alınamayan pazarlar ("FON", "BIST")
  function setRates(json) { rates = json ? JSON.parse(json) : null; }
  function setPrices(json) {
    const x = json ? JSON.parse(json) : {};
    prices = x.prices || {};
    pricesFailed = x.failed || [];
  }

  function loadState() {
    const raw = root.native?.load ? root.native.load() : "";
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    return T.hydrate(data || T.defaultState());
  }

  function ctxFor(today) {
    return {
      today,
      load: async () => loadState(),
      // Uygulamadaki gibi: araç veriyi değiştirir, Swift kaydeder ve değişen satırları eşitler (Tablo.changes)
      mutate: async fn => {
        const state = loadState();
        const result = await fn(state);
        root.native.save(JSON.stringify(state));
        return result;
      },
      rates: async () => { if (!rates) throw new Error("kurlar yok"); return rates; },
      prices: async codes => {
        const out = { prices: {}, missing: [], failed: [] };
        for (const c of codes) {
          if (prices[c]) out.prices[c] = prices[c];
          else {
            const m = V.market(c)?.market;
            if (m && !out.failed.includes(m)) out.failed.push(m);
          }
        }
        for (const m of pricesFailed) if (!out.failed.includes(m)) out.failed.push(m);
        return out;
      },
      searchFunds: async () => { throw Object.assign(new Error("Fon araması uygulamada henüz yok."), { userFacing: true }); },
      inbox: new Proxy({}, { get: () => async () => { throw Object.assign(new Error("Banka e-postaları uygulamada henüz yok."), { userFacing: true }); } }),
    };
  }

  // Aracı çalıştırır; done(sonucunJSON'u, null) ya da done(null, { message, user }). Araçlar beklenen hiçbir şeyi ağdan
  // almaz (kurlar hazır): sonuç JavaScriptCore çağrıdan dönerken (mikro görevler) gelir.
  function run(name, argsJson, today, done) {
    let finished = false;
    const finish = (out, err) => { if (!finished) { finished = true; done(out, err); } };
    try {
      if (!tools) throw new Error("araçlar yüklenmedi");
      const tool = tools.TOOLS.find(t => t.name === name);
      if (!tool) throw new Error(`bilinmeyen araç: ${name}`);
      const args = argsJson ? JSON.parse(argsJson) : {};
      Promise.resolve()
        .then(() => tool.run(args, ctxFor(today || tools.todayKey())))
        .then(
          out => finish(JSON.stringify(out ?? null), null),
          err => finish(null, { message: String(err?.message || err), user: err instanceof tools.ToolError || err?.userFacing === true }),
        );
    } catch (err) {
      finish(null, { message: String(err?.message || err), user: false });
    }
  }

  // Fiyatı çekilecek fon / hisse kodları (kayıtlı hareketlerden)
  function marketCodes() {
    const s = loadState();
    return [...new Set(s.entries.map(e => e.asset).filter(c => V.market(c)))].sort();
  }

  // Formlar için sabitler
  function constants() {
    return JSON.stringify({
      categories: K.CATEGORIES.map(c => ({ id: c.id, name: c.name, hint: c.hint })),
      assets: V.ASSETS.map(a => ({ code: a.code, name: a.name, short: a.short, symbol: a.symbol, digits: a.digits })),
    });
  }

  // ── Eşitleme (Senkron.swift): sync.js'in kullandığı Tablo işlevleri, JSON içinde JSON dışında ──
  const sync = {
    TABLES: Tablo.TABLES,
    SCHEMA: Tablo.SCHEMA,
    state: () => JSON.stringify(loadState()),
    // Veri boş mu (yalnızca varsayılan kişi; kart, harcama, hareket, borç yok): Tablo.stale'in "boş" koşulu
    isBlank: json => Tablo.stale(T.hydrate(json ? JSON.parse(json) : null), { cards: { _: "1" } }),
    stale: (stateJson, baseJson) => Tablo.stale(T.hydrate(JSON.parse(stateJson)), JSON.parse(baseJson)),
    rekey: baseJson => JSON.stringify(Tablo.rekey(JSON.parse(baseJson))),
    changes: (stateJson, baseJson) => JSON.stringify(Tablo.changes(T.hydrate(JSON.parse(stateJson)), JSON.parse(baseJson))),
    // Hiç eşitlenmemiş cihaz: tablolar esastır (ekrandaki verinin üstüne yazılır)
    fromRows: (stateJson, rowsJson) => {
      const rows = JSON.parse(rowsJson);
      const state = { ...T.hydrate(JSON.parse(stateJson)), ...Tablo.toState(rows) };
      return JSON.stringify({ state: T.hydrate(state), base: Tablo.baseOf(rows) });
    },
    merge: (stateJson, baseJson, rowsJson) => {
      let state = T.hydrate(JSON.parse(stateJson)), base = JSON.parse(baseJson), changed = false;
      const rows = JSON.parse(rowsJson);
      for (const t of Tablo.TABLES) {
        const out = Tablo.merge(state, base, t, rows[t] || []);
        ({ state, base } = out);
        changed = changed || out.changed;
      }
      return JSON.stringify({ state, base, changed });
    },
    combine: (accountJson, localJson) => JSON.stringify(Tablo.combine(T.hydrate(JSON.parse(accountJson)), T.hydrate(JSON.parse(localJson)))),
  };

  root.Kopru = { loadTools, toScript, setRates, setPrices, run, marketCodes, constants, sync, defaultState: () => JSON.stringify(T.defaultState()) };
})(this);
