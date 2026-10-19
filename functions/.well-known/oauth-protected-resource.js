// MCP istemcilerinin yetkilendirme sunucusunu (Supabase Auth) bulduğu adres (RFC 9728)
import { handle } from "../../mcp/server.js";

export const onRequest = ({ request, env }) => handle(request, env);
