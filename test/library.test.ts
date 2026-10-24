import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { Library } from "../src/db";

// Runs against a real local D1 (Miniflare), isolated from `wrangler dev` state.
let env: { DB: D1Database };
let dispose: () => Promise<void>;
let lib: Library;

const settings = {
  title: "Guji", ratio: 16, bloomEnabled: true, bloomRatio: 2, bloomDuration: 30, bloomTemperature: 96,
  ssPulsesEnabled: true, ssPulsesNumber: 1, ssPulsesInterval: 20, ssPulseTemperatures: [96],
  batchPulsesEnabled: true, batchPulsesNumber: 1, batchPulsesInterval: 30, batchPulseTemperatures: [96],
};

beforeAll(async () => {
  ({ env, dispose } = await getPlatformProxy<{ DB: D1Database }>({ persist: false }));
  lib = new Library(env.DB);
});
afterAll(() => dispose());

describe("brewer links", () => {
  it("keeps a link while the same profile is on the brewer", async () => {
    const a: any = await lib.saveProfile({ settings });
    await lib.setAidenId(a.id, "p3");
    expect((await lib.links([{ id: "p3", title: "Guji" }])).get("p3")?.id).toBe(a.id);
  });

  it("never trusts a reused id holding a different profile, and clears the link", async () => {
    const a: any = await lib.saveProfile({ settings });
    await lib.setAidenId(a.id, "p4");
    expect((await lib.links([{ id: "p4", title: "Someone else's Kenya" }])).has("p4")).toBe(false);
    expect((await lib.getProfileRow(a.id)).aiden_id).toBeNull();
  });

  it("clears links to profiles deleted in the Fellow app", async () => {
    const a: any = await lib.saveProfile({ settings });
    await lib.setAidenId(a.id, "p5");
    expect((await lib.links([])).size).toBe(0);
    expect((await lib.getProfileRow(a.id)).aiden_id).toBeNull();
  });
});

describe("versions and tastings", () => {
  it("carries coffee and grind hint into the next version", async () => {
    const c: any = await lib.addCoffee({ name: "Test coffee", process: "Natural" });
    const v1: any = await lib.saveProfile({ settings, coffeeId: c.id, grindHint: "Ode 2 @ 4" });
    const v2: any = await lib.saveProfile({ settings: { ...settings, title: "Guji v2" }, parentId: v1.id, changeNote: "sour: +1 °C" });
    expect(v2.version).toBe(2);
    expect(v2.coffee_id).toBe(c.id);
    expect(v2.grind_hint).toBe("Ode 2 @ 4");
    await lib.logTasting({ profileId: v1.id, rating: 2, notes: "sour" });
    const full: any = await lib.getProfileFull(v2.id);
    expect(full.history[0].avg_rating).toBe(2);
  });
});
