// ---------- Supabase erişimi (kullanıcının kendi token'ıyla) ----------
// MCP istemcisinin Supabase OAuth'tan aldığı erişim token'ı olduğu gibi Supabase'e iletilir; RLS kullanıcıyı
// yalnızca kendi satırlarıyla sınırlar. Sunucuda service role anahtarı yoktur.
// Kişiler, kartlar ve harcamalar ayrı tablolardadır (supabase/tablolar.sql); yalnızca değişen satırlar yazılır.
import T from "../taksit.js";
import Tablo from "../tablo.js";

export class StoreError extends Error {
  constructor(status, body) {
    super(`Supabase ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

// Token geçerliyse { id, email }, değilse null
export async function getUser({ url, key, token, fetch: f = fetch }) {
  const res = await f(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  if (res.status >= 400 && res.status < 500) return null;
  if (!res.ok) throw new StoreError(res.status, await res.text());
  const u = await res.json();
  return u?.id ? { id: u.id, email: u.email ?? null } : null;
}

const PAGE = 1000;   // PostgREST'in bir cevapta döndürdüğü en fazla satır
const BATCH = 200;   // bir istekte yazılan / silinen en fazla satır
const quote = v => `"${String(v).replace(/["\\]/g, "\\$&")}"`;   // PostgREST in.(…) değeri

export function createStore({ url, key, token, userId, fetch: f = fetch }) {
  const base = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function rest(path, { method = "GET", headers = {}, body } = {}) {
    const res = await f(`${url}/rest/v1/${path}`, { method, headers: { ...base, ...headers }, body });
    if (!res.ok) throw new StoreError(res.status, await res.text());
    const out = await res.text();
    return out ? JSON.parse(out) : null;
  }

  // Silinmemiş satırlar, listedeki sırayla
  async function readTable(table) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const q = new URLSearchParams({ select: "*", user_id: `eq.${userId}`, deleted_at: "is.null", order: "created_at,id", limit: PAGE, offset });
      const page = await rest(`${table}?${q}`);
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  async function readAll() {
    const lists = await Promise.all(Tablo.TABLES.map(readTable));
    return Object.fromEntries(Tablo.TABLES.map((t, i) => [t, lists[i]]));
  }

  // Tablo.changes çıktısı: önce kişiler, kartlar, harcamalar yazılır; sonra silinenler işaretlenir
  async function write(plan) {
    for (const t of Tablo.TABLES) {
      const list = plan[t].upsert;
      for (let i = 0; i < list.length; i += BATCH) {
        const body = list.slice(i, i + BATCH).map(x => ({ ...x.row, user_id: userId, deleted_at: null }));
        await rest(`${t}?on_conflict=user_id,id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(body) });
      }
    }
    const deleted_at = new Date().toISOString();
    for (const t of [...Tablo.TABLES].reverse()) {
      const list = plan[t].delete;
      for (let i = 0; i < list.length; i += BATCH) {
        const q = new URLSearchParams({ user_id: `eq.${userId}`, id: `in.(${list.slice(i, i + BATCH).map(quote).join(",")})` });
        await rest(`${t}?${q}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ deleted_at }) });
      }
    }
  }

  // inbox_* tabloları kurulmamışsa (supabase/eposta.sql) anlaşılır hata
  async function inboxRest(path, init) {
    try {
      return await rest(path, init);
    } catch (err) {
      if (err.status === 404 || /PGRST205|42P01/.test(err.body)) {
        throw Object.assign(new Error("Bank e-mails are not set up for this CashFollow installation."), { userFacing: true });
      }
      throw err;
    }
  }

  const ids = list => `in.(${list.map(Number).filter(Number.isFinite).join(",")})`;

  return {
    async load() {
      return T.hydrate(Tablo.toState(await readAll()));
    },

    // fn veriyi değiştirir; yalnızca değişen kayıtlar yazılır. Aynı anda başka cihazın değiştirdiği diğer kayıtlar
    // korunur, aynı kayıt iki yerde değiştiyse sonra yazan kazanır.
    async mutate(fn) {
      const rows = await readAll();
      const state = T.hydrate(Tablo.toState(rows));
      const result = await fn(state);
      await write(Tablo.changes(state, Tablo.baseOf(rows)));
      return result;
    },

    inbox: {
      async pending() {
        const q = new URLSearchParams({ select: "id,sender,subject,body,received_at", processed_at: "is.null", order: "received_at", limit: "50" });
        return inboxRest(`inbox_messages?${q}`);
      },
      // İşlenmemişleri işlendi yapar; başka cihaz önce davrandıysa o id dönmez
      async claim(list) {
        if (!list.length) return [];
        const q = new URLSearchParams({ id: ids(list), processed_at: "is.null", select: "id" });
        const rows = await inboxRest(`inbox_messages?${q}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ processed_at: new Date().toISOString() }) });
        return rows.map(r => r.id);
      },
      async release(list) {
        if (!list.length) return;
        const q = new URLSearchParams({ id: ids(list) });
        await inboxRest(`inbox_messages?${q}`, { method: "PATCH", body: JSON.stringify({ processed_at: null }) });
      },
      // "<adres>@INBOX_DOMAIN"; yoksa (ya da renew ile) yenisi oluşturulur
      async address(renew, domain) {
        const mine = new URLSearchParams({ user_id: `eq.${userId}` });
        if (renew) {
          await inboxRest(`inbox_addresses?${mine}`, { method: "DELETE" });
        } else {
          mine.set("select", "address");
          const rows = await inboxRest(`inbox_addresses?${mine}`);
          if (rows[0]) return `${rows[0].address}@${domain}`;
        }
        const rows = await inboxRest("inbox_addresses?select=address", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ user_id: userId }) });
        return `${rows[0].address}@${domain}`;
      },
    },
  };
}
