// Cloudflare Worker girişi (wrangler.jsonc): /mcp ve OAuth kaynak bilgisi MCP sunucusuna, /api/kur kurlara,
// /api/fiyat fon ve hisse fiyatlarına, /api/fonlar fon listesine, /api/gecmis geçmiş fiyatlara, /api/kategori kategori önerisine (Workers AI),
// gerisi statik dosyalara
import { handle } from "./server.js";
import { handleRates } from "./kur.js";
import { handlePrices, handleFunds, handleHistory } from "./piyasa.js";
import { handleCategories } from "./kategori.js";

export default {
  fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp" || pathname.startsWith("/.well-known/oauth-protected-resource")) return handle(request, env);
    if (pathname === "/api/kur") return handleRates(request, ctx);
    if (pathname === "/api/fiyat") return handlePrices(request, ctx);
    if (pathname === "/api/fonlar") return handleFunds(request, ctx);
    if (pathname === "/api/gecmis") return handleHistory(request, ctx);
    if (pathname === "/api/kategori") return handleCategories(request, env);
    return env.ASSETS.fetch(request);
  },
};
