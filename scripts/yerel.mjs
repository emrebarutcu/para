// Yerel geliştirme sunucusu: statik dosyalar ve Worker'ın /api uçları (gerçek kaynaklar: kur, fon, hisse, geçmiş).
// node scripts/yerel.mjs [port]   (varsayılan 3100; MCP ve /api/kategori için Supabase / Workers AI gerekir)
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2]) || 3100;
const { default: worker } = await import(path.join(ROOT, "mcp/worker.js"));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const env = {
  ASSETS: {
    async fetch(req) {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) return new Response("not found", { status: 404 });
      try {
        return new Response(await fs.readFile(file), { headers: { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" } });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  },
};

http.createServer(async (req, res) => {
  const r = await worker.fetch(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method }), env, { waitUntil() {} });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
