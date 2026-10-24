# Fellow Aiden connector for AI assistants

Snap a photo of a coffee bag and let your AI assistant design a brew profile for it, push it to your Fellow Aiden, and remember how it tasted. Works with **Claude**, **ChatGPT**, **Gemini** and **Le Chat**.

- **Photo → profile.** Your assistant reads the roaster, origin, process and roast level off the bag, picks starting settings, and loads the profile onto your Aiden.
- **A library that remembers.** Every profile, version, tasting note and 1–5 rating is kept. Say "the Guji was a bit sour" and it reads the history and proposes the next version.
- **A short brewer menu.** Only what you're brewing now lives on the Aiden. Finished coffees come off the brewer but stay in the library, ready to reload when you buy that bag again.
- **Your gear counts.** Record your grinder, filters and water. Profiles carry a grind setting for your grinder, and each tasting notes what gear you used.
- **Shared profiles.** Preview and import brew.link profiles, share your own, and have your assistant search the web for profiles other people have shared.
- **Schedules.** Set up and toggle the Aiden's scheduled brews.

It runs free on Cloudflare Workers, on your own account. Nothing runs on your home network.

> Unofficial and not affiliated with Fellow. It uses the same undocumented cloud API as the Fellow app, which could change without notice.

## 1. Deploy it (about 5 minutes)

You need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account (no card) and a free [GitHub](https://github.com/signup) account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wardnb/fellow-aiden-mcp)

On the setup screen:

1. **Git account:** pick your GitHub account. Cloudflare copies this project into a new repo there and deploys from it.
2. **Project name:** anything, e.g. `aiden-connector`. It becomes part of your URL. It must not match a repo name you already have.
3. **Storage and database:** leave as **Create new**.
4. **Secrets:**

   | Secret | What to enter |
   |---|---|
   | `FELLOW_EMAIL` | The email you sign in to the Fellow app with |
   | `FELLOW_PASSWORD` | Your Fellow app password |
   | `ACCESS_PASSWORD` | A **new** password you make up, 12+ characters. You'll type it once when connecting your AI app. |

5. Click **Deploy** and wait a minute or two.

**Check it.** Open your Worker's address, like `https://aiden-connector.<you>.workers.dev`. You should see three green checks and your **connector URL**, which ends in `/mcp`. Copy it for the next step.

> **Fix a secret later:** Cloudflare dashboard → ☰ → **Workers & Pages** → your Worker → **Settings** → **Variables and Secrets**. Edit and save; it takes effect immediately. (The account-wide "Secrets Store" is a different feature — you don't need it.)

## 2. Connect your AI app

Every app uses the same connector URL. When a sign-in page appears, enter your `ACCESS_PASSWORD` and tap **Allow**.

### Claude

Works on every plan, including Free (Free allows one custom connector).

1. **Customize → Connectors**, then **+ Add → Add custom connector**. On Team or Enterprise, an owner adds it under **Organization settings → Connectors** first.
2. Name it `Fellow Aiden`, paste the connector URL, and click **Continue**.
3. Keep the detected sign-in settings and click **Add**, then sign in.
4. In a chat, use **+ → Connectors** to make sure it's turned on.

The brewing guide reaches Claude automatically when it connects.

### ChatGPT

Custom connectors need **Developer mode**. Which plans get it, and whether write actions (saving and loading profiles) are allowed, varies by plan; Business, Enterprise and Edu have full support.

1. On **chatgpt.com** (web): **Settings → Apps & Connectors → Advanced settings**, turn on **Developer mode**. Workspace admins may need to allow it first.
2. Back in **Apps & Connectors**, click **Create**. Name it `Fellow Aiden`, paste the connector URL, set **Authentication** to **OAuth**, and create it. Sign in when asked.
3. In a chat, use **+ → More** and pick the connector.

ChatGPT may not follow the brewing guide the server sends. For best results, create a **Project** and paste the contents of [`skills/aiden-brewing/SKILL.md`](skills/aiden-brewing/SKILL.md) into its instructions.

### Gemini

Custom apps currently need a **personal Google account**, age 18+, in the **US**, with **Keep Activity** on, and are added on the **web** only (they then work in the mobile app too).

1. At **gemini.google.com**: **Settings → Connected Apps** (or **Personal Intelligence → Connected Apps**).
2. Under **Custom apps**, click **Add a custom app**, paste the connector URL, click **Next**, and sign in.
3. In a chat, type **@** and pick the app.

If Gemini doesn't follow the brewing guide, paste [`SKILL.md`](skills/aiden-brewing/SKILL.md) into a Gem's instructions.

### Le Chat (Mistral)

Account owners on Free, Pro and Student plans can add connectors.

1. **Intelligence → Connectors → + Add Connector**, then the **Custom MCP Connector** tab.
2. Name it `FellowAiden` (no spaces or special characters), paste the connector URL, and click **Connect**. Sign in when asked.

### Perplexity, Copilot and others

- **Perplexity** (Pro / Enterprise) has custom remote connectors under **Settings → + Custom connector → Remote**, but a [known Perplexity bug](https://community.perplexity.ai/t/custom-mcp-connector-fails-with-did-not-return-a-client-secret-for-rfc-7591-compliant-public-client-registrations/5172) can break sign-in with servers like this one. It may or may not work for you.
- **Microsoft Copilot** supports custom MCP servers only for organizations (Microsoft 365 / Copilot Studio), set up by an admin.
- **Any other MCP client** that supports remote servers with OAuth 2.1 should work: the server supports PKCE (S256), dynamic client registration, client ID metadata documents, and RFC 9207 issuer identification.

## 3. First steps

1. *"What's on my Aiden? Save it all to my library."* Copies your existing profiles into the library.
2. Tell it your gear: *"I use a Baratza Encore, Hario V60 #02 filters for single cups, the Aiden's stock filter for the carafe, and RO water."*
3. Send a photo of a bag: *"Make me a profile for this."*
4. After brewing: *"The Mast was a bit sour, 3 out of 5."* It proposes the next version.
5. Trim the menu: *"Take everything off the brewer except my two current coffees."*

More things to ask:

- "What did I like best from Ethiopia?"
- "That bag's done. Take its profile off the brewer."
- "Find a shared brew.link profile for Onyx Monarch and compare it to mine."
- "Brew the Kenya at 6:30 on weekdays, 600 ml."

## Troubleshooting

| What you see | What it means |
|---|---|
| **HTTP 401** when you open the `/mcp` URL in a browser | Normal. That address only answers your AI app after it signs in. Open the Worker's main address for the status page instead. |
| A ⚠️ on the status page | That secret is missing or too short. Fix it under **Variables and Secrets** (see above). |
| **Wrong password** on the sign-in page | Try again on the same page. After 10 wrong tries in an hour, sign-in from that network pauses until the hour is up. |
| **This sign-in page expired** | Sign-in pages last 15 minutes. Remove and re-add the connector in your AI app to start fresh. |
| **Fellow login failed** | `FELLOW_EMAIL` or `FELLOW_PASSWORD` doesn't match your Fellow app login. |
| **Fellow Drops won't come off the brewer** | Fellow manages Drops (roaster profiles) separately, and its API doesn't let them be removed. They're still saved in your library. Hide them in the Fellow app if it offers that. |
| The brewer shows a change late | The Aiden syncs from Fellow's cloud over Wi-Fi, usually within a minute. |

## Keeping your copy up to date

The Deploy button made a **copy** of this project in your GitHub, and your Worker redeploys whenever that copy changes. Fixes made here don't flow to your copy automatically. To update: replace your copy's `src/` and `skills/` folders with the latest ones from this repo, but **keep your own `wrangler.jsonc`**. It holds the IDs of your database and storage. Commit, and Cloudflare redeploys.

## How it works

```
AI app ──OAuth──▶ Cloudflare Worker ──HTTPS──▶ Fellow cloud API ──Wi-Fi──▶ Aiden
                       │
                       └── D1 library: coffees · profile versions · tastings · equipment
```

- **Sign-in.** The Worker is its own OAuth 2.1 server (Cloudflare's `workers-oauth-provider`). Your AI app registers, you approve once with `ACCESS_PASSWORD`, and it gets a 1-hour token that it refreshes (refresh tokens last 30 days). The sign-in form carries the request HMAC-signed with a 15-minute expiry, so it works in in-app sign-in windows that drop cookies. Wrong passwords are throttled per network, and the page can't be framed.
- **Fellow credentials** are stored as encrypted Worker secrets and sent only to Fellow. Fellow has no scoped API keys, so this is your full account password; treat the Worker accordingly.
- **Guardrails.** Profiles are checked against the Aiden's limits before anything is sent. Revising, unloading and deleting need explicit confirmation. Built-in Fellow profiles can't be changed, and profiles used by a schedule can't be unloaded. Links between the library and the brewer are re-checked before every change, because brewer IDs get reused after deletions.
- **The library database** creates its own tables on first use, so there are no migrations to run.
- **The brewing guide** lives in [`skills/aiden-brewing/SKILL.md`](skills/aiden-brewing/SKILL.md). It's bundled into the Worker and sent as the server's instructions. To change how profiles are designed and adjusted, edit that file and redeploy. You can also upload the folder as a Claude skill, but you don't need to.
- **Multiple brewers:** if your Fellow account has more than one device, the one holding profiles is used.

## Tools

| Area | Tools |
|---|---|
| Brewer | `brewer_status`, `brewer_adopt`, `brewer_load`, `brewer_unload` |
| Coffees | `coffee_add`, `coffee_list`, `coffee_set_status` |
| Library | `library_save_profile`, `library_search`, `library_get_profile`, `library_revise_profile`, `library_archive_profile`, `tasting_log` |
| Equipment | `equipment_add`, `equipment_list`, `equipment_update` |
| Shared | `brewlink_preview`, `brewlink_import`, `brewlink_share` |
| Schedules | `schedule_create`, `schedule_set_enabled`, `schedule_delete` |

## Develop

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in
npm run dev                      # http://localhost:8787
npm test && npm run typecheck
npm run deploy
```

## Credits and license

Fellow API endpoints come from [fellow-aiden](https://github.com/9b/fellow-aiden) by Brandon Dixon (GPL-3.0). This project is a TypeScript reimplementation and is also licensed under GPL-3.0.
