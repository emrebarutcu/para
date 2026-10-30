// ---------- Supabase tabloları ↔ uygulama verisi (DOM'dan bağımsız) ----------
// Uygulama veriyi tek nesne olarak tutar ({ people, cards, installments, entries, debts }); Supabase'te her kişi, kart,
// harcama, varlık hareketi ve borç kaydı ayrı bir satırdır (supabase/tablolar.sql). Senkronizasyon (sync.js, mcp/supabase.js) son eşitlenen satırları
// (taban: tablo → id → satırın JSON'u) bugünkü veriyle karşılaştırır: yalnızca değişen satırlar yazılır, veriden
// çıkanlar silindi olarak işaretlenir. Uzaktan gelen satır, yerelde henüz yazılmamış değişikliği ezmez.
(function (root) {
  // Yazma sırası da budur: harcama kişisine ve kartına, hareket ve borç kişisine bağlıdır
  const TABLES = ["people", "cards", "purchases", "entries", "debts"];
  const FIELD = { people: "people", cards: "cards", purchases: "installments", entries: "entries", debts: "debts" };
  const ASSETS = ["TRY", "USD", "EUR", "GAU"];   // varlik.js
  // Fon ve hisse (varlik.js market): yalnızca varlık hareketlerinde
  const MARKET = /^(FON:[A-Z0-9]{3}|BIST:[A-Z][A-Z0-9]{2,5})$/;
  const DEBT_KINDS = ["person", "loan", "payment"], DEBT_SIDES = ["debt", "receivable"];   // borc.js

  const num = v => (typeof v === "number" ? v : Number(v));
  // Artı, sonlu tutar; değilse null (Infinity JSON'da null olur, tablonun kısıtını ihlal eder)
  function pos(v) {
    const n = num(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function int(v, lo, hi) {
    const n = Math.round(num(v));
    return n >= lo && n <= hi ? n : null;
  }
  const validId = id => typeof id === "string" && id.length > 0 && id.length <= 100;
  // Harcama kategorisi (kategori.js) ve kimin verdiği: "user" kullanıcı seçti / onayladı, "ai" cihazdaki model önerdi
  const validCategory = c => typeof c === "string" && /^[a-z]{1,20}$/.test(c);
  const CATEGORY_BY = ["user", "ai"];

  // Tekrar (tekrar.js): repeat_count 0 (süresiz) ya da 2…600, repeat_every 1…99, repeat_unit day | week | month.
  // Tek seferlikte üçü de boş; varsayılanlar (her 1, ay) boş yazılır.
  const UNITS = ["day", "week", "month"];
  function repeatCols(x) {
    const n = x.repeat;
    if (!(Number.isInteger(n) && (n === 0 || (n >= 2 && n <= 600)))) return { repeat_count: null, repeat_every: null, repeat_unit: null };
    const every = Number.isInteger(x.every) && x.every >= 2 && x.every <= 99 ? x.every : null;
    return { repeat_count: n, repeat_every: every, repeat_unit: UNITS.includes(x.unit) && x.unit !== "month" ? x.unit : null };
  }
  function repeatFields(r, item) {
    if (r.repeat_count == null) return;
    item.repeat = r.repeat_count;
    if (r.repeat_every > 1) item.every = r.repeat_every;
    if (UNITS.includes(r.repeat_unit) && r.repeat_unit !== "month") item.unit = r.repeat_unit;
  }

  // "YYYY-MM-DD"; ayı aşan gün ayın son gününe çekilir (taksit.js'teki gibi), geçersizse null
  function dateKey(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s ?? ""));
    if (!m) return null;
    const mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const day = Math.min(d, new Date(Number(m[1]), mo, 0).getDate());
    return `${m[1]}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // Kartın eski günleri (taksit.js → kart): [{ until, cutoffDay, dueDay }] ↔ [{ until, cutoff_day, due_day }];
  // geçersizler atılır, until'e göre sıralanır, boşsa null
  function history(list, cutoff, due) {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const h of list) {
      const until = dateKey(h?.until), c = int(h?.[cutoff], 1, 31), d = int(h?.[due], 1, 31);
      if (until && c != null && d != null) out.push({ until, c, d });
    }
    out.sort((a, b) => (a.until < b.until ? -1 : a.until > b.until ? 1 : 0));
    return out.length ? out : null;
  }

  // Kayıt → satır (user_id'siz); tablonun kısıtlarını ihlal edecek kayıt için null (yalnızca yerelde kalır)
  const ROW = {
    people: p => ({ id: p.id, name: String(p.name ?? ""), color: int(p.color, 0, 999) ?? 0 }),
    cards: c => {
      const cutoff = int(c.cutoffDay, 1, 31), due = int(c.dueDay, 1, 31);
      if (cutoff == null || due == null) return null;
      return {
        id: c.id, name: String(c.name ?? ""), credit_limit: Math.max(num(c.limit) || 0, 0),
        cutoff_day: cutoff, due_day: due, color: int(c.color, 0, 999) ?? 0,
        last4: /^\d{4}$/.test(c.last4) ? c.last4 : null,
        history: history(c.history, "cutoffDay", "dueDay")?.map(h => ({ until: h.until, cutoff_day: h.c, due_day: h.d })) ?? null,
        track_since: dateKey(c.trackSince), track_off: c.trackOff === true, manual_since: dateKey(c.manualSince),
      };
    },
    purchases: p => {
      const total = num(p.total), count = int(p.count, 1, 100000), date = dateKey(p.date);
      const firstDue = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.firstDue) ? p.firstDue : null;
      if (!validId(p.personId) || !(total > 0) || count == null || (!date && !firstDue)) return null;
      return {
        id: p.id, person_id: p.personId, card_id: validId(p.cardId) ? p.cardId : null,
        description: String(p.desc ?? ""), total, count, date, first_due: firstDue,
        plan_count: int(p.planCount, 1, 100000),
        category: validCategory(p.category) ? p.category : null,
        category_by: validCategory(p.category) && CATEGORY_BY.includes(p.categoryBy) ? p.categoryBy : null,
        asset: ASSETS.includes(p.asset) && p.asset !== "TRY" ? p.asset : null,
        ...(date ? repeatCols(p) : repeatCols({})),
      };
    },
    // Fon / hisse tekrarlamaz. price birim fiyat ya da kur (TL; fon, hisse, döviz ve altında, tek seferlik), settle
    // yalnızca fiyatla (miktar × fiyat TL bakiyesine işlenir)
    entries: e => {
      const amount = num(e.amount), date = dateKey(e.date), market = MARKET.test(e.asset);
      if (!validId(e.personId) || !(ASSETS.includes(e.asset) || market) || !Number.isFinite(amount) || amount === 0 || !date) return null;
      const rep = repeatCols(market ? {} : e);
      const price = e.asset !== "TRY" && rep.repeat_count == null ? pos(e.price) : null;
      return {
        id: e.id, person_id: e.personId, asset: e.asset, amount, description: String(e.desc ?? ""), date,
        ...rep, price, settle: price != null && e.settle === true ? true : null,
      };
    },
    // Borç kaydı (borc.js): person kişiyle borç / alacak, loan kredi, payment ödeme / tahsilat (debt_id boşsa kart payı)
    debts: d => {
      const kind = DEBT_KINDS.includes(d.kind) ? d.kind : null, date = dateKey(d.date);
      if (!kind || !validId(d.personId) || !date) return null;
      const amount = pos(d.amount);
      if (amount == null) return null;
      const head = kind !== "payment";
      const due = head ? dateKey(d.due) : null;
      const count = head && due ? int(d.count, 1, 600) : null;
      if (head && !ASSETS.includes(d.asset)) return null;
      if (kind === "person" && !DEBT_SIDES.includes(d.side)) return null;
      if (kind === "loan" && (!due || count == null)) return null;
      return {
        id: d.id, kind, person_id: d.personId,
        debt_id: kind === "payment" && validId(d.debtId) ? d.debtId : null,
        card_id: kind === "payment" && !validId(d.debtId) && validId(d.cardId) ? d.cardId : null,
        side: kind === "person" ? d.side : null,
        party: head && d.party ? String(d.party) : null,
        description: String(d.desc ?? ""),
        asset: head ? d.asset : null,
        amount, principal: head ? pos(d.principal) : null,
        date, due, count,
        // Ödeme modu: boşsa türün varsayılanı (kredi otomatik, kişisel borç elle)
        auto_pay: kind === "person" && due && d.autoPay === true ? true : kind === "loan" && d.autoPay === false ? false : null,
        closed: head ? dateKey(d.closed) : null,
      };
    },
  };

  // Satır → kayıt (uygulamadaki biçim: boş alanlar yazılmaz)
  const ITEM = {
    people: r => ({ id: r.id, name: r.name, color: r.color }),
    cards: r => {
      const c = { id: r.id, name: r.name, limit: Number(r.credit_limit), cutoffDay: r.cutoff_day, dueDay: r.due_day, color: r.color };
      if (r.last4) c.last4 = r.last4;
      const h = history(r.history, "cutoff_day", "due_day");
      if (h) c.history = h.map(x => ({ until: x.until, cutoffDay: x.c, dueDay: x.d }));
      const since = dateKey(r.track_since);
      if (since) c.trackSince = since;
      if (r.track_off === true) c.trackOff = true;
      const manual = dateKey(r.manual_since);
      if (manual) c.manualSince = manual;
      return c;
    },
    purchases: r => {
      const p = { id: r.id, personId: r.person_id, cardId: r.card_id, desc: r.description, total: Number(r.total), count: r.count };
      if (r.date) p.date = r.date;
      if (r.first_due) p.firstDue = r.first_due;
      if (r.plan_count) p.planCount = r.plan_count;
      if (validCategory(r.category)) {
        p.category = r.category;
        if (CATEGORY_BY.includes(r.category_by)) p.categoryBy = r.category_by;
      }
      if (ASSETS.includes(r.asset) && r.asset !== "TRY") p.asset = r.asset;
      repeatFields(r, p);
      return p;
    },
    entries: r => {
      const e = { id: r.id, personId: r.person_id, asset: r.asset, amount: Number(r.amount), desc: r.description, date: r.date };
      repeatFields(r, e);
      if (r.price != null) e.price = Number(r.price);
      if (r.settle === true) e.settle = true;
      return e;
    },
    debts: r => {
      const d = { id: r.id, kind: r.kind, personId: r.person_id };
      if (r.debt_id) d.debtId = r.debt_id;
      if (r.card_id) d.cardId = r.card_id;
      if (r.side) d.side = r.side;
      if (r.party) d.party = r.party;
      if (r.description) d.desc = r.description;
      if (r.asset) d.asset = r.asset;
      d.amount = Number(r.amount);
      if (r.principal != null) d.principal = Number(r.principal);
      d.date = r.date;
      if (r.due) d.due = r.due;
      if (r.count != null) d.count = Number(r.count);
      if (r.auto_pay === true) d.autoPay = true;
      else if (r.auto_pay === false) d.autoPay = false;
      if (r.closed) d.closed = r.closed;
      return d;
    },
  };

  function keyOf(table, item) {
    const row = item && validId(item.id) ? ROW[table](item) : null;
    return row ? JSON.stringify(row) : null;
  }

  // Satır biçimi (ROW) değişince artırılır. Önceki biçimle kaydedilmiş taban rekey ile çevrilir; yoksa yeni sütun
  // yüzünden her kayıt yerelde değişmiş görünür, eşitleme bütün satırları yeni sütunu boş yazarak ezer.
  const SCHEMA = 7;   // 2: cards.history, entries.repeat_count; 3: purchases.category, category_by;
                      // 4: purchases.asset, repeat_count / repeat_every / repeat_unit, entries.repeat_every / repeat_unit;
                      // 5: cards.track_since / track_off (debts yeni tablo); 6: cards.manual_since, debts.card_id;
                      // 7: entries.price / settle (fon, hisse, döviz ve altın)

  // Eski biçimdeki taban → bugünkü biçim (satırda olmayan sütun boş sayılır)
  function rekey(base) {
    const out = {};
    for (const t of TABLES) {
      out[t] = {};
      for (const [id, key] of Object.entries(base?.[t] || {})) {
        let k = null;
        try { k = keyOf(t, ITEM[t](JSON.parse(key))); } catch {}
        if (k) out[t][id] = k;
      }
    }
    return out;
  }

  const listOf = (state, table) => (Array.isArray(state?.[FIELD[table]]) ? state[FIELD[table]] : []);
  const byCreation = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1);

  // Tablo satırları ({ people: [satır], … }) → veri. Kişi yoksa people yazılmaz: hydrate varsayılan kişiyi koyar.
  function toState(rows) {
    const state = {};
    for (const t of TABLES) {
      const list = (rows[t] || []).filter(r => !r.deleted_at).sort(byCreation).map(ITEM[t]);
      if (list.length || t !== "people") state[FIELD[t]] = list;
    }
    return state;
  }

  // Tablodaki satırlar eşitlenmiş kabul edilir
  function baseOf(rows) {
    const base = {};
    for (const t of TABLES) {
      base[t] = {};
      for (const r of rows[t] || []) {
        const key = r.deleted_at ? null : keyOf(t, ITEM[t](r));
        if (key) base[t][r.id] = key;
      }
    }
    return base;
  }

  // Ekrandaki veri boş (yalnızca varsayılan kişi; kart, harcama, hareket, borç yok) ama taban eşitlenmiş kayıt biliyorsa
  // taban bu cihazın verisini anlatmaz (yerel veri kaybolmuş): cihaz hiç eşitlenmemiş sayılır, tablolar esastır.
  // Yoksa changes tabandaki her kaydı silinmiş sanır, hesaptaki bütün veri silinirdi.
  function stale(state, base) {
    const blank = TABLES.every(t => listOf(state, t).every(x => t === "people" && x?.id === "ben"));
    return blank && TABLES.some(t => Object.keys(base?.[t] || {}).some(id => !(t === "people" && id === "ben")));
  }

  // Yazılacaklar: tablo → { upsert: [{ id, key, row }], delete: [id] }. Taban, yazma başarılınca key'lerle güncellenir.
  // Harcamanın / hareketin / borç kaydının kişisi tabloda yoksa yazılmaz; harcamanın kartı yoksa nakit yazılır (uygulamada da nakit sayılır).
  function changes(state, base) {
    const out = {}, exists = {};
    for (const t of TABLES) {
      const known = base?.[t] || {};
      const seen = new Set(), upsert = [];
      exists[t] = new Set(Object.keys(known));
      for (const item of listOf(state, t)) {
        if (!item || !validId(item.id) || seen.has(item.id)) continue;
        seen.add(item.id);
        const key = keyOf(t, item);
        if (!key) continue;
        exists[t].add(item.id);
        if (key !== known[item.id]) upsert.push({ id: item.id, key, row: JSON.parse(key) });
      }
      out[t] = { upsert, delete: Object.keys(known).filter(id => !seen.has(id)) };
    }
    out.entries.upsert = out.entries.upsert.filter(x => exists.people.has(x.row.person_id));
    // Kartı tabloda olmayan kart ödemesi yazılmaz (kartsız ödeme kart payı ödemesi demektir, boşaltılmaz)
    out.debts.upsert = out.debts.upsert.filter(x => exists.people.has(x.row.person_id) && (!x.row.card_id || exists.cards.has(x.row.card_id)));
    out.purchases.upsert = out.purchases.upsert
      .filter(x => exists.people.has(x.row.person_id))
      .map(x => (x.row.card_id && !exists.cards.has(x.row.card_id) ? { ...x, row: { ...x.row, card_id: null } } : x));
    return out;
  }

  // Uzaktan gelen satırları (silinmişler dahil) veriye işler. Yerelde eşitlenmemiş değişikliği olan kayıt olduğu gibi
  // kalır, sonraki yazmada uzağı ezer. → { state, base, changed }; state yalnızca değiştiyse yeni nesnedir.
  function merge(state, base, table, rows) {
    const list = [...listOf(state, table)];
    const index = new Map();
    list.forEach((x, i) => { if (!index.has(x?.id)) index.set(x?.id, i); });   // aynı id'den ilki (changes gibi)
    const known = { ...(base?.[table] || {}) };
    let changed = false;
    for (const r of rows) {
      const item = r.deleted_at ? null : ITEM[table](r);
      const key = item ? keyOf(table, item) : undefined;   // silinmişse undefined
      if (key === null) continue;                           // uygulamanın kullanamayacağı satır
      const i = index.get(r.id);
      const local = i === undefined ? undefined : list[i];
      const localKey = local === undefined ? undefined : keyOf(table, local);
      if (localKey === key) {                               // zaten aynı
        if (key) known[r.id] = key; else delete known[r.id];
        continue;
      }
      if (localKey !== known[r.id]) continue;               // yerel değişiklik bekliyor
      if (key) {
        if (i === undefined) { index.set(r.id, list.length); list.push(item); } else list[i] = item;
        known[r.id] = key;
      } else {
        if (i !== undefined) list[i] = undefined;
        index.delete(r.id);
        delete known[r.id];
      }
      changed = true;
    }
    return {
      state: changed ? { ...state, [FIELD[table]]: list.filter(x => x !== undefined) } : state,
      base: { ...base, [table]: known },
      changed,
    };
  }

  // Girişsiz kullanılan cihazın verisini (local) hesabın verisine (account) ekler. Aynı id'li kayıt aynı kayıttır
  // (daha önce eşitlenmiş olabilir; varsayılan kişi her yerde "ben"), iki kez eklenmez. Kişi aynı adlı kişiyle, kart
  // aynı son 4 haneli ya da aynı adlı kartla birleşir; harcama, hareket ve borçlar birleşilen kişiye / karta bağlanır.
  // Birleşen kartın takibi daha erken başlayanınkidir.
  function combine(account, local) {
    const out = { ...account };
    const name = s => String(s ?? "").trim().toLocaleLowerCase("tr-TR");
    const absorb = (field, same) => {
      const list = [...(account[field] || [])], map = {};
      for (const item of local[field] || []) {
        if (!item || !validId(item.id)) continue;
        const match = list.find(x => x.id === item.id) || list.find(x => same(x, item));
        map[item.id] = match ? match.id : item.id;
        if (!match) list.push(item);
      }
      out[field] = list;
      return map;
    };
    const people = absorb("people", (a, b) => name(a.name) === name(b.name));
    const cards = absorb("cards", (a, b) => (a.last4 && b.last4 ? a.last4 === b.last4 : name(a.name) === name(b.name)));
    for (const item of local.cards || []) {
      const at = out.cards.findIndex(x => x.id === cards[item?.id] && x !== item);
      if (at < 0 || !item.trackSince || item.trackOff === true) continue;   // takip dışı kartın tarihi yalnızca öneridir
      const kept = out.cards[at];
      if (!kept.trackSince || item.trackSince < kept.trackSince) out.cards[at] = { ...kept, trackSince: item.trackSince };
    }
    // Yerelde elle ödenen kart hesapta otomatikse elle mod yerelden gelir: yereldeki kart ödemeleri (ön ödeme dahil)
    // otomatik kartta önceki ekstrelerde erirdi (borc.js cardPrepaid)
    for (const item of local.cards || []) {
      const at = out.cards.findIndex(x => x.id === cards[item?.id] && x !== item);
      if (at < 0 || !item.manualSince || item.trackOff === true) continue;
      const kept = out.cards[at];
      if (kept.manualSince || kept.trackOff === true) continue;
      const from = item.trackSince && item.trackSince > item.manualSince ? item.trackSince : item.manualSince;
      out.cards[at] = { ...kept, manualSince: from };
    }
    for (const field of ["installments", "entries", "debts"]) {
      const list = [...(account[field] || [])], ids = new Set(list.map(x => x.id));
      for (const item of local[field] || []) {
        if (!item || ids.has(item.id)) continue;
        ids.add(item.id);
        const moved = { ...item, personId: people[item.personId] ?? item.personId };
        if (item.cardId) moved.cardId = cards[item.cardId] ?? item.cardId;
        list.push(moved);
      }
      out[field] = list;
    }
    return out;
  }

  const api = { TABLES, FIELD, SCHEMA, keyOf, rekey, toState, baseOf, stale, changes, merge, combine };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Tablo = api;
})(this);
