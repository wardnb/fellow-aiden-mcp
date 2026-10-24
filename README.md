# Fellow Aiden connector for Claude

Snap a photo of a coffee bag and let Claude design a brew profile for it, push it to your Fellow Aiden, and remember how it tasted.

- **Photo → profile.** Claude reads the roaster, origin, process and roast level off the bag, picks starting settings, and loads the profile onto your Aiden.
- **A library that remembers.** Every profile, version, tasting note and 1–5 rating is kept. Ask "the Guji was a bit sour" and Claude reads the history and proposes the next version.
- **A short brewer menu.** Only what you're brewing now lives on the Aiden. Finished coffees come off the brewer but stay in the library, ready to reload when you buy that bag again.
- **Your gear counts.** Record your grinder, filters and water. Profiles carry a grind setting for your grinder, and each tasting notes what gear you used.
- **Shared profiles.** Preview and import brew.link profiles, share your own, and let Claude search the web for profiles other people have shared.
- **Schedules.** Set up and toggle the Aiden's scheduled brews.

It runs free on Cloudflare Workers. Nothing runs on your home network.

> Unofficial and not affiliated with Fellow. It uses the same undocumented cloud API as the Fellow app, which could change without notice.

## Set it up (about 5 minutes)

**1. Deploy.** Click the button and sign in to Cloudflare (a free account is fine, no card needed).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wardnb/fellow-aiden-mcp)

The setup screen asks for three secrets:

| Secret | What to enter |
|---|---|
| `FELLOW_EMAIL` | The email you sign in to the Fellow app with |
| `FELLOW_PASSWORD` | Your Fellow app password |
| `ACCESS_PASSWORD` | A new password you make up, 12+ characters. You'll type it once when connecting Claude. |

The database and storage are created for you.

**2. Check it.** Open your Worker's URL (shown after deploy, like `https://fellow-aiden-mcp.<you>.workers.dev`). The page shows green checks and your connector URL ending in `/mcp`.

**3. Connect Claude.** In Claude, add a custom connector and paste the `/mcp` URL. A sign-in page opens: enter your `ACCESS_PASSWORD` and click **Allow**.

That's all. The brewing know-how (starting points by roast and process, how to adjust from tasting notes, the workflow) comes with the connector: it's sent to Claude when it connects.

**4. Start.** Try: *"Look at what's on my Aiden and save it to my library."* Then add your gear: *"I use a Fellow Ode Gen 2 with the stock burrs, Aiden paper filters and Third Wave Water."* Then send a photo of a bag: *"Make me a profile for this."*

## Things to ask

- "Make a profile for this bag" (with a photo)
- "Yesterday's cup was a little sour and thin. Adjust it."
- "Rate the Guji v2 a 5: juicy, clean, sweet."
- "That bag's done. Take its profile off the brewer."
- "What did I like best from Ethiopia?"
- "Find a shared brew.link profile for Onyx Monarch and compare it to mine."
- "Brew the Kenya at 6:30 on weekdays, 600 ml."

## How it works

```
Claude ──OAuth──▶ Cloudflare Worker ──HTTPS──▶ Fellow cloud API ──Wi-Fi──▶ Aiden
                       │
                       └── D1 library: coffees · profile versions · tastings · equipment
```

- **Sign-in.** The Worker is its own OAuth server (Cloudflare's `workers-oauth-provider`). Claude registers, you approve once with `ACCESS_PASSWORD`, and Claude gets a 1-hour token that it refreshes. Wrong passwords are throttled to 10 per hour. Consent forms are bound to your browser and can't be framed or forged.
- **Fellow credentials** are stored as encrypted Worker secrets and sent only to Fellow. Fellow has no scoped API keys, so this is your full account password; treat the Worker accordingly.
- **Guardrails.** Profiles are validated against the Aiden's limits before anything is sent. Revising, unloading and deleting require explicit confirmation. Built-in Fellow profiles can't be changed. Profiles used by a schedule can't be unloaded.
- The **library database** creates its own tables on first use, so there are no migrations to run.
- The **brewing guide** lives in [`skills/aiden-brewing/SKILL.md`](skills/aiden-brewing/SKILL.md). It's bundled into the Worker and sent as the server's instructions. To change how Claude designs and adjusts profiles, edit that file and redeploy. You can also upload the folder as a Claude skill, but you don't need to.

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
npm run deploy                   # or use the button
```

One Aiden per Fellow account is assumed (the first brewer is used).

## Credits and license

Fellow API endpoints and profile limits come from [fellow-aiden](https://github.com/9b/fellow-aiden) by Brandon Dixon (GPL-3.0). This project is a TypeScript reimplementation and is also licensed under GPL-3.0.
