// ---------- CashFollow MCP sunucusu (Streamable HTTP, durumsuz) ----------
// POST /mcp → JSON-RPC (initialize, tools/list, tools/call, ping); cevaplar düz JSON, oturum tutulmaz.
// Kimlik doğrulama: Supabase OAuth 2.1. Token'sız istek 401 + WWW-Authenticate alır; istemci
// /.well-known/oauth-protected-resource'tan Supabase'in yetkilendirme sunucusunu bulur, kullanıcı
// cashfollow.app/oauth/consent'te izin verir. Bağımlılığı yoktur; sitenin Worker'ından çağrılır (worker.js).
import { TOOLS, INSTRUCTIONS, ToolError, todayKey } from "./tools.js";
import { createStore, getUser } from "./supabase.js";
import { getRates } from "./kur.js";
import { getPrices, searchFunds } from "./piyasa.js";

// config.js ile aynı (herkese açık değerler); Worker → Settings → Variables ile değiştirilebilir
const DEFAULTS = {
  SUPABASE_URL: "https://bffqfhgctlgexjdyvaup.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_KoF5Tfi74v8RSWvszPeuxQ_LWwKZGDo",
  INBOX_DOMAIN: "cashfollow.app",
};

const SERVER_INFO = { name: "cashfollow", title: "CashFollow", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = "2025-06-18";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...headers } });
}

export function config(env = {}) {
  return {
    url: (env.SUPABASE_URL || DEFAULTS.SUPABASE_URL).replace(/\/+$/, ""),
    key: env.SUPABASE_ANON_KEY || DEFAULTS.SUPABASE_ANON_KEY,
    domain: env.INBOX_DOMAIN || DEFAULTS.INBOX_DOMAIN,
  };
}

// RFC 9728: bu kaynağı hangi yetkilendirme sunucusunun koruduğu
export function resourceMetadata(origin, env) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [`${config(env).url}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "CashFollow",
    resource_documentation: `${origin}/`,
  };
}

function unauthorized(origin, error) {
  const params = [`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`];
  if (error) params.unshift(`error="${error}"`);
  return json({ error: error || "unauthorized", error_description: "Sign in to CashFollow to use this server." }, 401,
    { "WWW-Authenticate": `Bearer ${params.join(", ")}` });
}

// Token → kullanıcı; her araç çağrısında Supabase'e sormamak için kısa süreli önbellek
const USER_TTL = 60_000;
const users = new Map();
export async function userFor(token, cfg, f) {
  const now = Date.now();
  const hit = users.get(token);
  if (hit && hit.exp > now) return hit.user;
  const user = await getUser({ ...cfg, token, fetch: f });
  if (users.size > 500) users.clear();
  if (user) users.set(token, { user, exp: now + USER_TTL });
  return user;
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function callTool(params, ctx) {
  const tool = TOOLS.find(t => t.name === params?.name);
  if (!tool) return { error: [-32602, `Unknown tool: ${params?.name}`] };
  const args = params.arguments ?? {};
  if (typeof args !== "object" || Array.isArray(args)) return { error: [-32602, "arguments must be an object"] };
  try {
    const out = await tool.run(args, ctx);
    return { result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] } };
  } catch (err) {
    const known = err instanceof ToolError || err.userFacing;
    if (!known) console.error(`tool ${tool.name}:`, err);
    return { result: { content: [{ type: "text", text: known ? err.message : "CashFollow could not complete this request; try again." }], isError: true } };
  }
}

async function dispatch(msg, ctx) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0", id,
        result: { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } })) },
      };
    case "tools/call": {
      const out = await callTool(params, ctx);
      return out.error ? rpcError(id, ...out.error) : { jsonrpc: "2.0", id, result: out.result };
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function handle(request, env = {}, { fetch: f = fetch, now = () => new Date() } = {}) {
  const url = new URL(request.url);
  const cfg = config(env);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
    return json(resourceMetadata(url.origin, env), 200, { "Cache-Control": "public, max-age=3600" });
  }
  if (request.method !== "POST") {
    return json({ error: "CashFollow MCP server: send MCP requests with POST.", docs: `${url.origin}/` }, 405, { Allow: "POST, OPTIONS" });
  }

  const auth = request.headers.get("Authorization") || "";
  const token = auth.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return unauthorized(url.origin);
  const user = await userFor(token, cfg, f);
  if (!user) return unauthorized(url.origin, "invalid_token");

  let body;
  try { body = await request.json(); } catch { return json(rpcError(null, -32700, "Parse error"), 400); }

  const store = createStore({ ...cfg, token, userId: user.id, fetch: f });
  const ctx = {
    today: todayKey(now()),
    user,
    load: store.load,
    mutate: store.mutate,
    inbox: { ...store.inbox, address: renew => store.inbox.address(renew, cfg.domain) },
    rates: () => getRates({ fetch: f }),
    prices: codes => getPrices(codes, { fetch: f, now: () => now().getTime() }),
    searchFunds: (q, limit) => searchFunds(q, { limit, fetch: f, now: () => now().getTime() }),
  };

  const batch = Array.isArray(body);
  const replies = [];
  for (const msg of batch ? body : [body]) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") { replies.push(rpcError(msg?.id ?? null, -32600, "Invalid request")); continue; }
    if (msg.id === undefined || !msg.method) continue;   // bildirim ya da cevap: karşılık verilmez
    replies.push(await dispatch(msg, ctx));
  }
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? replies : replies[0]);
}
