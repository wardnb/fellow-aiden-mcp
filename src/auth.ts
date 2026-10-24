/**
 * Single-user sign-in for the connector.
 *
 * When Claude connects, the user lands on /authorize, enters the ACCESS_PASSWORD
 * set at deploy time, and approves. The OAuth library handles tokens, PKCE and
 * client registration; this file renders the page and checks the password.
 *
 * No cookies and no storage lookups: some in-app sign-in windows (e.g. the Claude
 * mobile app) don't keep cookies, and KV doesn't guarantee a fresh write is readable
 * right away. So the validated authorization request travels in the form, signed
 * with HMAC (key derived from ACCESS_PASSWORD) and expiring after 15 minutes. On
 * submit the signature, expiry, client and redirect URI are all re-checked. The
 * password is what stops forged approvals, and the page can't be framed.
 */
import {
  AuthorizationError,
  CimdFetchError,
  authorizationErrorRedirect,
  type AuthRequest,
  type ConsentDescription,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";

export interface AuthEnv {
  ACCESS_PASSWORD: string;
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
}

const MAX_FAILURES_PER_HOUR = 10;
const MIN_PASSWORD_LENGTH = 12;
const PENDING_TTL_MS = 15 * 60 * 1000;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function stateKey(password: string) {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`aiden-connector/consent-state/v1:${password}`));
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Sign a validated auth request into a form token: payload.signature */
async function sealState(req: AuthRequest, password: string) {
  const payload = new TextEncoder().encode(JSON.stringify({ r: req, e: Date.now() + PENDING_TTL_MS }));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(password), payload));
  return `${b64url(payload)}.${b64url(sig)}`;
}

/** Verify a form token; returns the auth request, or null if forged, malformed or expired. */
async function openState(token: string, password: string): Promise<AuthRequest | null> {
  try {
    const [p, sig, extra] = token.split(".");
    if (!p || !sig || extra !== undefined || token.length > 16384) return null;
    const payload = unb64url(p);
    if (!(await crypto.subtle.verify("HMAC", await stateKey(password), unb64url(sig), payload))) return null;
    const { r, e } = JSON.parse(new TextDecoder().decode(payload));
    return typeof e === "number" && e > Date.now() ? (r as AuthRequest) : null;
  } catch {
    return null;
  }
}

const escape = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
:root{--bg:#f6f3ee;--card:#fff;--ink:#1f1b16;--muted:#6b6258;--line:#e4ddd3;--accent:#7a4a24;--warn:#9a3412}
@media (prefers-color-scheme:dark){:root{--bg:#171411;--card:#211d19;--ink:#f1ece6;--muted:#a69c90;--line:#3a332c;--accent:#d69a62;--warn:#f59e6b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
main{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;max-width:420px;width:100%}
h1{font-size:1.25rem;margin:0 0 4px}p{color:var(--muted);margin:8px 0}strong{color:var(--ink)}
label{display:block;font-weight:600;margin:18px 0 6px}input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;padding:11px;border-radius:8px;border:1px solid var(--line);font:inherit;font-weight:600;cursor:pointer;background:var(--card);color:var(--ink)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.warn{color:var(--warn)}code{font-size:.9em}`;

export function page(title: string, body: string, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>${STYLE}</style><main>${body}</main></html>`,
    { status, headers },
  );
}

function consentPage(d: ConsentDescription, state: string, error?: string) {
  const who = d.clientDomain
    ? `<strong>${escape(d.clientName)}</strong> (published by <strong>${escape(d.clientDomain)}</strong>)`
    : `<strong>${escape(d.clientName)}</strong> <span class="warn">(name not verified)</span>`;
  return page(
    "Connect to your Aiden",
    `<h1>Connect to your Fellow Aiden</h1>
     <p>${who} wants to manage your brew profiles, coffee library and schedules.</p>
     <p>Access goes to <strong>${escape(d.redirectHost)}</strong>.</p>
     ${d.redirectIsLoopback ? '<p class="warn">This sends access to an app on your own computer. Continue only if you just started connecting from it.</p>' : ""}
     ${error ? `<p class="warn"><strong>${escape(error)}</strong></p>` : ""}
     <form method="post">
       <input type="hidden" name="state" value="${escape(state)}">
       <label for="pw">Connector password</label>
       <input id="pw" type="password" name="password" autocomplete="current-password" autofocus>
       <div class="row"><button name="decision" value="deny">Deny</button><button class="primary" name="decision" value="approve">Allow</button></div>
     </form>`,
    error ? 401 : 200,
    new Headers({ "Cache-Control": "no-store" }),
  );
}

async function sha256(s: string) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
}

async function passwordMatches(given: string, expected: string) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * Failed attempts are counted per client IP per hour. Per-IP (not global) so a stranger
 * can't lock the owner out by burning attempts. KV is eventually consistent, so this is a
 * speed bump against casual guessing; the real defense is a long ACCESS_PASSWORD.
 */
const failureKey = (request: Request) =>
  `auth:failures:${request.headers.get("CF-Connecting-IP") ?? "unknown"}:${new Date().toISOString().slice(0, 13)}`;

const expired = () =>
  page(
    "Sign-in expired",
    "<h1>This sign-in page expired</h1><p>Sign-in pages expire after 15 minutes. Start connecting again from Claude or ChatGPT.</p>",
    400,
  );

export async function handleAuthorize(request: Request, env: AuthEnv): Promise<Response> {
  if (!env.ACCESS_PASSWORD || env.ACCESS_PASSWORD.length < MIN_PASSWORD_LENGTH) {
    return page("Setup needed", `<h1>Setup needed</h1><p>Set an <code>ACCESS_PASSWORD</code> secret of at least ${MIN_PASSWORD_LENGTH} characters on this Worker, then try connecting again.</p>`, 503);
  }
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request); // validates client, redirect URI, PKCE
      const details = await oauth.describeConsent(authRequest);
      return consentPage(details, await sealState(authRequest, env.ACCESS_PASSWORD));
    }

    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const form = await request.formData();
    const state = String(form.get("state") ?? "");
    const authRequest = await openState(state, env.ACCESS_PASSWORD);
    if (!authRequest) return expired();
    // Defense in depth: the client must still exist and still own this redirect URI.
    const client = await oauth.lookupClient(authRequest.clientId);
    if (!client || !client.redirectUris.includes(authRequest.redirectUri)) return expired();

    if (form.get("decision") !== "approve") {
      return Response.redirect(authorizationErrorRedirect(authRequest, "access_denied"), 302);
    }

    const key = failureKey(request);
    const failures = Number((await env.OAUTH_KV.get(key)) ?? 0);
    if (failures >= MAX_FAILURES_PER_HOUR) {
      return page("Locked", "<h1>Too many attempts</h1><p>Sign-in from this network is paused for the rest of this hour.</p>", 429);
    }
    if (!(await passwordMatches(String(form.get("password") ?? ""), env.ACCESS_PASSWORD))) {
      // KV allows ~1 write/sec per key; a dropped increment must not turn into a 500.
      await env.OAUTH_KV.put(key, String(failures + 1), { expirationTtl: 3600 }).catch(() => {});
      return consentPage(await oauth.describeConsent(authRequest), state, "Wrong password. Try again.");
    }

    const { redirectTo } = await oauth.completeAuthorization({
      request: authRequest,
      userId: "owner",
      metadata: {},
      scope: authRequest.scope,
      props: { user: "owner" },
    });
    return Response.redirect(redirectTo, 302);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const msg = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
      return page("Can't connect", `<h1>Can't connect</h1><p>${escape(msg ?? "The request was not valid.")}</p><p>Start connecting again from Claude.</p>`, 400);
    }
    throw error;
  }
}
