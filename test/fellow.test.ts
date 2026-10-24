import { afterEach, describe, expect, it, vi } from "vitest";
import { FellowClient } from "../src/fellow";

// In-memory KV stand-in: the client only uses get/put/delete for its token cache.
const kv = () => {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v), delete: async (k: string) => void m.delete(k) } as unknown as KVNamespace;
};

/** Fake Fellow API: routes "METHOD /path" to a JSON body. */
function fakeFellow(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname.replace(/^\/v1/, "")}`;
    calls.push(key);
    if (key === "POST /auth/login") return Response.json({ accessToken: "t", refreshToken: "r" });
    if (key in routes) return Response.json(routes[key]);
    return new Response("not found", { status: 404 });
  });
  return calls;
}

const client = () => new FellowClient({ FELLOW_EMAIL: "a@b.c", FELLOW_PASSWORD: "x", OAUTH_KV: kv() });
afterEach(() => vi.unstubAllGlobals());

describe("FellowClient.getDevice", () => {
  it("uses profiles bundled in the device record (original API shape)", async () => {
    const calls = fakeFellow({ "GET /devices": [{ id: "d1", displayName: "Aiden", profiles: [{ id: "p0", title: "A" }], schedules: [] }] });
    expect(await client().getProfiles()).toHaveLength(1);
    expect(calls).not.toContain("GET /devices/d1/profiles");
  });

  it("falls back to the profiles endpoint when the record has none", async () => {
    fakeFellow({
      "GET /devices": [{ id: "d1", displayName: "Aiden" }],
      "GET /devices/d1/profiles": [{ id: "p0", title: "A" }, { id: "p1", title: "B" }],
      "GET /devices/d1/schedules": [{ id: "s0" }],
    });
    const c = client();
    expect(await c.getProfiles()).toHaveLength(2);
    expect(await c.getSchedules()).toHaveLength(1);
    expect(c.lastDeviceScan[0]).toMatchObject({ profiles: 2, profilesFrom: "profiles endpoint" });
  });

  it("accepts a wrapped list from the profiles endpoint", async () => {
    fakeFellow({ "GET /devices": [{ id: "d1", profiles: [] }], "GET /devices/d1/profiles": { profiles: [{ id: "p0", title: "A" }] } });
    expect(await client().getProfiles()).toHaveLength(1);
  });

  it("picks the device that has profiles when the account has several", async () => {
    fakeFellow({
      "GET /devices": [
        { id: "old", displayName: "Old Aiden", profiles: [], schedules: [] },
        { id: "new", displayName: "Aiden", profiles: [{ id: "p0", title: "A" }, { id: "p1", title: "B" }], schedules: [] },
      ],
    });
    const c = client();
    const d = await c.getDevice();
    expect(d.id).toBe("new");
    expect(c.lastDeviceScan.map((s) => s.profiles)).toEqual([0, 2]);
  });

  it("returns an empty list, not an error, when a brewer truly has no profiles", async () => {
    fakeFellow({ "GET /devices": [{ id: "d1", profiles: [], schedules: [] }] });
    expect(await client().getProfiles()).toEqual([]);
  });
});
