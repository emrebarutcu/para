// cashfollow.app/mcp — LLM'ler için MCP sunucusu (mcp/server.js). Cloudflare Pages yayında kendiliğinden derler.
import { handle } from "../mcp/server.js";

export const onRequest = ({ request, env }) => handle(request, env);
