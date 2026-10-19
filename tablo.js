// ---------- Supabase tabloları ↔ uygulama verisi (DOM'dan bağımsız) ----------
// Uygulama veriyi tek nesne olarak tutar ({ people, cards, installments, entries }); Supabase'te her kişi, kart,
// harcama ve varlık hareketi ayrı bir satırdır (supabase/tablolar.sql). Senkronizasyon (sync.js, mcp/supabase.js) son eşitlenen satırları
// (taban: tablo → id → satırın JSON'u) bugünkü veriyle karşılaştırır: yalnızca değişen satırlar yazılır, veriden
// çıkanlar silindi olarak işaretlenir. Uzaktan gelen satır, yerelde henüz yazılmamış değişikliği ezmez.
(function (root) {
  // Yazma sırası da budur: harcama kişisine ve kartına, hareket kişisine bağlıdır
  const TABLES = ["people", "cards", "purchases", "entries"];
  const FIELD = { people: "people", cards: "cards", purchases: "installments", entries: "entries" };
  const ASSETS = ["TRY", "USD", "EUR", "GAU"];   // varlik.js

  const num = v => (typeof v === "number" ? v : Number(v));
  function int(v, lo, hi) {
    const n = Math.round(num(v));
    return n >= lo && n <= hi ? n : null;
  }
  const validId = id => typeof id === "string" && id.length > 0 && id.length <= 100;

  // "YYYY-MM-DD"; ayı aşan gün ayın son gününe çekilir (taksit.js'teki gibi), geçersizse null
  function dateKey(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s ?? ""));
    if (!m) return null;
    const mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const day = Math.min(d, new Date(Number(m[1]), mo, 0).getDate());
    return `${m[1]}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
      };
    },
    entries: e => {
      const amount = num(e.amount), date = dateKey(e.date);
      if (!validId(e.personId) || !ASSETS.includes(e.asset) || !Number.isFinite(amount) || amount === 0 || !date) return null;
      return { id: e.id, person_id: e.personId, asset: e.asset, amount, description: String(e.desc ?? ""), date };
    },
  };

  // Satır → kayıt (uygulamadaki biçim: boş alanlar yazılmaz)
  const ITEM = {
    people: r => ({ id: r.id, name: r.name, color: r.color }),
    cards: r => {
      const c = { id: r.id, name: r.name, limit: Number(r.credit_limit), cutoffDay: r.cutoff_day, dueDay: r.due_day, color: r.color };
      if (r.last4) c.last4 = r.last4;
      return c;
    },
    purchases: r => {
      const p = { id: r.id, personId: r.person_id, cardId: r.card_id, desc: r.description, total: Number(r.total), count: r.count };
      if (r.date) p.date = r.date;
      if (r.first_due) p.firstDue = r.first_due;
      if (r.plan_count) p.planCount = r.plan_count;
      return p;
    },
    entries: r => ({ id: r.id, personId: r.person_id, asset: r.asset, amount: Number(r.amount), desc: r.description, date: r.date }),
  };

  function keyOf(table, item) {
    const row = item && validId(item.id) ? ROW[table](item) : null;
    return row ? JSON.stringify(row) : null;
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

  // Yazılacaklar: tablo → { upsert: [{ id, key, row }], delete: [id] }. Taban, yazma başarılınca key'lerle güncellenir.
  // Harcamanın / hareketin kişisi tabloda yoksa yazılmaz; harcamanın kartı yoksa nakit yazılır (uygulamada da nakit sayılır).
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
  // aynı son 4 haneli ya da aynı adlı kartla birleşir; harcama ve hareketler birleşilen kişiye / karta bağlanır.
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
    for (const field of ["installments", "entries"]) {
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

  const api = { TABLES, FIELD, keyOf, toState, baseOf, changes, merge, combine };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Tablo = api;
})(this);
