---
name: aiden-brewing
description: Design, dial in and manage Fellow Aiden brew profiles with the Fellow Aiden connector — from a photo of a coffee bag, from tasting feedback, or from shared brew.link profiles.
---

# Fellow Aiden brewing

Use with the **Fellow Aiden** connector (tools named `brewer_*`, `coffee_*`, `library_*`, `tasting_log`, `equipment_*`, `brewlink_*`, `schedule_*`).

## How the pieces fit

- **The library** holds every coffee, profile version, tasting note, rating and piece of equipment. It is the memory. Nothing in it is lost when a profile leaves the brewer.
- **The brewer** is a short shelf of what's being brewed right now. Profiles are *loaded* onto it and *unloaded* from it. Aim for a short menu: when it holds more than about six custom profiles, offer to unload ones whose coffee is finished.
- **Grind lives in the library**, not the Aiden. Every profile should carry a `grindHint` in terms of the user's own grinder.
- First time with a user: call `brewer_status`. If it shows profiles with `inLibrary: false`, offer `brewer_adopt` so they're kept. Call `equipment_list`; if it's empty, ask what grinder (and its setting scale), filters and water they use and record them with `equipment_add`.

## Photo of a bag → profile

1. Read the bag: roaster, coffee name, origin/region, process, roast level, variety, altitude, roast date, tasting notes. Don't invent anything the bag doesn't show; ask only about what changes the profile (roast level is the big one if it isn't printed).
2. `library_search` for the roaster or coffee. If it's been brewed before, start from the best-rated version and say so.
3. `coffee_add` with what the bag shows.
4. `equipment_list` so the grind hint uses their grinder's scale.
5. Design the profile from the starting points below. Show it compactly — ratio, bloom (ratio / time / temp), single-serve pulses (count / interval / temps), batch pulses, grind — with one line on *why* for this coffee.
6. On approval: `library_save_profile` with `coffeeId`, `grindHint`, `source: "designed from bag photo"`, `loadOnBrewer: true`.
7. Ask them to log how it tastes next time (`tasting_log`).

Title: under 50 characters, short enough to read on the brewer, e.g. `Onyx Guji Natural`. Versions after the first get ` v2`, ` v3`.

## Starting points

All temperatures °C. Aiden limits: ratio 14–20 (0.5 steps); bloom ratio 1–3 (0.5 steps), 1–120 s; temps 50–99 (0.5 steps); 1–10 pulses at 5–60 s intervals. Each pulse-temperature list needs exactly one entry per pulse.

| Roast | Ratio | Bloom | Brew temps | Single-serve pulses | Batch pulses |
|---|---|---|---|---|---|
| Light | 16–17 | 2.5–3×, 40–60 s, 96–97 | 95–97 | 3–4 @ 20–25 s | 2–3 @ 30–40 s |
| Medium | 16 | 2–2.5×, 30–45 s, 94 | 92–94 | 3 @ 20 s | 2 @ 30 s |
| Dark | 15–15.5 | 2×, 25–30 s, 90 | 88–91 | 2–3 @ 15–20 s | 2 @ 25–30 s |

Adjust for the coffee:
- **Process.** Washed: the table as is. Natural, honey, anaerobic or co-ferment: about 1 °C cooler and a slightly coarser grind, so ferment and fruit stay clean rather than boozy.
- **Freshness.** Roasted under ~7 days ago: longer bloom (+15 s). Over ~5 weeks: a touch hotter, shorter bloom.
- **High altitude / dense coffees** (e.g. many Kenyan, Ethiopian, Colombian): the hotter end. Low-grown or decaf: cooler end, coarser.
- **Stepped temperatures** are a good default for light roasts: start hot and fall about 0.5–1 °C per pulse to keep the finish sweet.
- Batch pulses: fewer and longer than single-serve, since the bed is deeper.

## Dialing in from tasting notes

Always `library_get_profile` first. It returns the tasting history and every earlier version with its rating, so you can see what was already tried and never undo a change that helped.

Change one or two things per version, grind first when the grind is likely the cause:

| They taste | Likely | Change |
|---|---|---|
| Sour, sharp, thin, salty, quick finish | Under-extracted | Grind finer one step; then +1–2 °C; then +1 pulse or +10 s bloom |
| Bitter, dry, astringent, harsh finish | Over-extracted | Grind coarser one step; then −1–2 °C; then −1 pulse |
| Weak or watery but balanced | Too dilute | Ratio down 0.5–1 (e.g. 16 → 15.5) |
| Heavy, muddy, too intense | Too strong | Ratio up 0.5–1 |
| Flat, muted, not much fruit | Low extraction of aromatics | +1 °C, or stepped temps starting hotter |
| Sour *and* bitter together | Uneven extraction | Coarser plus a longer bloom; ask about filter and grinder |

Propose the change and the reason, then on approval call `library_revise_profile` with `changes`, a `changeNote` that names the taste problem and the fix (e.g. "sour finish: grind finer, +1 °C"), any new `grindHint`, and `confirm: true`. If it was on the brewer, it's updated in place so schedules keep working.

If the user mentions new gear (grinder, burrs, filters, water), update it with `equipment_add` / `equipment_update` before adjusting: a gear change can explain a taste change, and tastings snapshot the active setup.

## Bag finished / rotating coffees

When a bag runs out: `coffee_set_status` to `finished`, then offer `brewer_unload` for any of its profiles still on the brewer. When they buy it again: set it `active`, `library_search` for the best-rated version, and `brewer_load` it.

## Finding public profiles

Fellow has no public profile catalog. To find shared profiles, use web search for `brew.link/p/` together with the roaster or coffee name (roaster websites and r/FellowProducts are common sources). Preview candidates with `brewlink_preview`, compare them with what the bag suggests, and save the good ones with `brewlink_import` (link it to the coffee). Credit the source in conversation.

To share one of theirs, use `brewlink_share`.

## Rules

- Get the user's go-ahead before anything that changes the brewer or library: show settings first. Unload, revise and delete tools require `confirm: true`; only set it after the user explicitly agrees.
- Never unload a profile a schedule uses; the tool refuses, and the user should change the schedule first.
- If a Fellow call fails, say so plainly. The connector reaches the Aiden only through Fellow's cloud, so an outage or an offline brewer will block brewer changes, while library tools keep working.
