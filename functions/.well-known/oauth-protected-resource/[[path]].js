// /.well-known/oauth-protected-resource/mcp — kaynağa özel biçim (RFC 9728 §3.1)
import { handle } from "../../../mcp/server.js";

export const onRequest = ({ request, env }) => handle(request, env);
