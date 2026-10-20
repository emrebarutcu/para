// Cloudflare Worker girişi (wrangler.jsonc): /mcp ve OAuth kaynak bilgisi MCP sunucusuna, /api/kur kurlara,
// /api/kategori kategori önerisine (Workers AI),
// gerisi statik dosyalara
import { handle } from "./server.js";
import { handleRates } from "./kur.js";
import { handleCategories } from "./kategori.js";

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp" || pathname.startsWith("/.well-known/oauth-protected-resource")) return handle(request, env);
    if (pathname === "/api/kur") return handleRates(request, ctx);
    if (pathname === "/api/kategori") return handleCategories(request, env);
    return env.ASSETS.fetch(request);
  },
};
