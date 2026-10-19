// Cloudflare Worker girişi (wrangler.jsonc): /mcp ve OAuth kaynak bilgisi MCP sunucusuna, gerisi statik dosyalara
import { handle } from "./server.js";

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp" || pathname.startsWith("/.well-known/oauth-protected-resource")) return handle(request, env);
    return env.ASSETS.fetch(request);
  },
};
