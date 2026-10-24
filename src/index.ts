/**
 * Fellow Aiden MCP connector — Cloudflare Worker entry point.
 *
 *   /mcp         MCP endpoint (OAuth bearer token required)
 *   /authorize   sign-in page shown when Claude connects
 *   /token, /register, /.well-known/*   handled by the OAuth library
 *   /            setup status page
 */
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { handleAuthorize, page, type AuthEnv } from "./auth";
import { buildServer, type ToolEnv } from "./tools";

export interface Env extends ToolEnv, Omit<AuthEnv, "OAUTH_PROVIDER"> {}

const mcpApi: ExportedHandler<Env> = {
  async fetch(request, env) {
    const handler = createMcpHandler(() => buildServer(env));
    return handler.fetch(request);
  },
};

const site: ExportedHandler<Env & { OAUTH_PROVIDER: AuthEnv["OAUTH_PROVIDER"] }> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/authorize") return handleAuthorize(request, env);
    if (url.pathname === "/" && request.method === "GET") {
      const check = (ok: boolean, label: string) => `<p>${ok ? "✅" : "⚠️"} ${label}</p>`;
      return page(
        "Aiden connector",
        `<h1>Fellow Aiden connector</h1>
         ${check(!!env.FELLOW_EMAIL && !!env.FELLOW_PASSWORD, "Fellow account secrets set")}
         ${check((env.ACCESS_PASSWORD ?? "").length >= 12, "Connector password set (12+ characters)")}
         ${check(!!env.DB, "Library database bound")}
         <p>Add this URL as a custom connector in Claude, or as an MCP connector in ChatGPT:</p>
         <p><strong><code>${url.origin}/mcp</code></strong></p>`,
      );
    }
    return new Response("Not found", { status: 404 });
  },
};

// The OAuth resource must be this Worker's own URL, which isn't known until it's
// deployed (workers.dev subdomains differ per account), so build it from the request.
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(origin: string) {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpApi as ExportedHandler<Env> & { fetch: NonNullable<ExportedHandler<Env>["fetch"]> },
      defaultHandler: site as ExportedHandler<Env>,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      // Client ID Metadata Documents: ChatGPT's preferred registration method (DCR still works for Claude).
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: { resource: `${origin}/mcp`, resource_name: "Fellow Aiden" },
      accessTokenTTL: 60 * 60,
      refreshTokenTTL: 30 * 24 * 60 * 60,
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "http:" && !local) {
      // Never serve the password form or tokens over plain HTTP.
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    return providerFor(url.origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
