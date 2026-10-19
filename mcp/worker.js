// Cloudflare Worker girişi (wrangler.jsonc): /mcp ve OAuth kaynak bilgisi MCP sunucusuna, /api/kur kurlara,
// gerisi statik dosyalara
import { handle } from "./server.js";
import { handleRates } from "./kur.js";

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp" || pathname.startsWith("/.well-known/oauth-protected-resource")) return handle(request, env);
    if (pathname === "/api/kur") return handleRates(request, ctx);
    return env.ASSETS.fetch(request);
  },
};
