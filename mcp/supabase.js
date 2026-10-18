// ---------- Supabase erişimi (kullanıcının kendi token'ıyla) ----------
// MCP istemcisinin Supabase OAuth'tan aldığı erişim token'ı olduğu gibi Supabase'e iletilir; RLS kullanıcıyı
// yalnızca kendi satırlarıyla sınırlar. Sunucuda service role anahtarı yoktur.
import T from "../taksit.js";

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

const RETRIES = 4;   // aynı anda başka cihaz yazarsa

export function createStore({ url, key, token, userId, fetch: f = fetch }) {
  const base = { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  async function rest(path, { method = "GET", headers = {}, body } = {}) {
    const res = await f(`${url}/rest/v1/${path}`, { method, headers: { ...base, ...headers }, body });
    if (!res.ok) throw new StoreError(res.status, await res.text());
    const out = await res.text();
    return out ? JSON.parse(out) : null;
  }

  async function readRow() {
    const q = new URLSearchParams({ select: "data,updated_at", user_id: `eq.${userId}` });
    const rows = await rest(`cashflow_data?${q}`);
    return rows[0] ?? null;
  }

  // updated_at değişmemişse yazar (iyimser kilit); başka bir yazma araya girdiyse false
  async function write(row, state) {
    const updated_at = new Date().toISOString();
    if (!row) {
      try {
        await rest("cashflow_data", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, data: state, updated_at }) });
        return true;
      } catch (err) {
        if (err.status === 409) return false;
        throw err;
      }
    }
    const q = new URLSearchParams({ user_id: `eq.${userId}`, updated_at: row.updated_at == null ? "is.null" : `eq.${row.updated_at}`, select: "user_id" });
    const out = await rest(`cashflow_data?${q}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ data: state, updated_at }) });
    return out.length > 0;
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
      return T.hydrate((await readRow())?.data ?? {});
    },

    // fn veriyi değiştirir; uygulama (sync.js) _v'si daha yeni olan veriyi alır
    async mutate(fn) {
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        const row = await readRow();
        const state = T.hydrate(structuredClone(row?.data ?? {}));
        const result = await fn(state);
        state._v = Date.now();
        if (await write(row, state)) return result;
      }
      throw new Error("Data changed on another device while saving; try again.");
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
