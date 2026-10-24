/**
 * Minimal client for Fellow's cloud API, which the Fellow app uses to manage
 * the Aiden. Unofficial and undocumented: endpoints were taken from the
 * community `fellow-aiden` Python library and may change without notice.
 *
 * Nothing here talks to the brewer directly. Changes land in Fellow's cloud
 * and the Aiden syncs them over its own Wi-Fi connection.
 */

const BASE_URL = "https://l8qtmnc692.execute-api.us-west-2.amazonaws.com/v1";
// The API expects the Fellow iOS app's user agent.
const USER_AGENT = "Fellow/5 CFNetwork/1568.300.101 Darwin/24.2.0";
const TOKEN_KEY = "fellow:access-token";
const TOKEN_TTL_SECONDS = 45 * 60;

export interface FellowEnv {
  FELLOW_EMAIL: string;
  FELLOW_PASSWORD: string;
  OAUTH_KV: KVNamespace;
}

export type Json = Record<string, unknown>;

export class FellowError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** fetch, but a network failure becomes a readable error instead of an opaque runtime one. */
async function reach(url: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new FellowError(`Couldn't reach Fellow's servers (${err instanceof Error ? err.message : String(err)}). Try again in a minute.`);
  }
}

export class FellowClient {
  private token: string | null = null;
  private device: Json | null = null;

  constructor(private readonly env: FellowEnv) {
    if (!env.FELLOW_EMAIL || !env.FELLOW_PASSWORD) {
      throw new FellowError("FELLOW_EMAIL and FELLOW_PASSWORD secrets are not set on this Worker.");
    }
  }

  // ---- auth -------------------------------------------------------------

  private async login(): Promise<string> {
    const res = await reach(BASE_URL + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ email: this.env.FELLOW_EMAIL, password: this.env.FELLOW_PASSWORD }),
    });
    const body = (await res.json().catch(() => ({}))) as Json;
    if (typeof body.accessToken !== "string") {
      throw new FellowError("Fellow login failed. Check the FELLOW_EMAIL and FELLOW_PASSWORD secrets.", res.status);
    }
    this.token = body.accessToken;
    await this.env.OAUTH_KV.put(TOKEN_KEY, this.token, { expirationTtl: TOKEN_TTL_SECONDS });
    return this.token;
  }

  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const cached = await this.env.OAUTH_KV.get(TOKEN_KEY);
    if (cached) return (this.token = cached);
    return this.login();
  }

  private async request(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<Response> {
    const url = new URL(BASE_URL + path);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const send = async (token: string) =>
      reach(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": USER_AGENT,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

    let res = await send(await this.getToken());
    if (res.status === 401) {
      // Cached token expired: log in again once and retry.
      await this.env.OAUTH_KV.delete(TOKEN_KEY);
      this.token = null;
      res = await send(await this.login());
    }
    return res;
  }

  private async json(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<any> {
    const res = await this.request(method, path, body, query);
    const text = await res.text();
    let parsed: any = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const detail = typeof parsed === "object" && parsed?.message ? parsed.message : text.slice(0, 300);
      throw new FellowError(`Fellow API ${method} ${path} failed (${res.status}): ${detail}`, res.status);
    }
    return parsed;
  }

  // ---- device -----------------------------------------------------------

  /** What getDevice saw, for brewer_status diagnostics (no secrets). */
  lastDeviceScan: { id: string; name: unknown; profiles: number; schedules: number; profilesFrom: string }[] = [];

  /** A list field that may arrive bare or wrapped (e.g. `{ profiles: [...] }`). */
  private static list(value: unknown, key: string): Json[] | null {
    if (Array.isArray(value)) return value as Json[];
    if (value && typeof value === "object" && Array.isArray((value as Json)[key])) return (value as Json)[key] as Json[];
    return null;
  }

  /**
   * The account's brewer, with its profiles and schedules.
   *
   * Profiles and schedules are read from the device record when Fellow bundles them,
   * otherwise from the device's own /profiles and /schedules endpoints. When the account
   * has several devices (e.g. an old registration), the one with profiles is chosen.
   */
  async getDevice(refresh = false): Promise<Json> {
    if (this.device && !refresh) return this.device;
    const devices = await this.json("GET", "/devices", undefined, { dataType: "real" });
    if (!Array.isArray(devices) || devices.length === 0) {
      throw new FellowError("No Aiden brewer is registered to this Fellow account.");
    }
    const scanned: Json[] = [];
    this.lastDeviceScan = [];
    for (const raw of devices as Json[]) {
      const d: Json = { ...raw };
      let profilesFrom = "device record";
      let profiles = FellowClient.list(d.profiles, "profiles");
      if (!profiles || profiles.length === 0) {
        profiles = FellowClient.list(await this.json("GET", `/devices/${encodeURIComponent(String(d.id))}/profiles`).catch(() => null), "profiles") ?? [];
        profilesFrom = "profiles endpoint";
      }
      let schedules = FellowClient.list(d.schedules, "schedules");
      if (!schedules) {
        schedules = FellowClient.list(await this.json("GET", `/devices/${encodeURIComponent(String(d.id))}/schedules`).catch(() => null), "schedules") ?? [];
      }
      d.profiles = profiles;
      d.schedules = schedules;
      scanned.push(d);
      this.lastDeviceScan.push({ id: `…${String(d.id).slice(-6)}`, name: d.displayName ?? null, profiles: profiles.length, schedules: schedules.length, profilesFrom });
    }
    // Prefer the brewer that actually holds profiles; ties keep Fellow's order.
    this.device = scanned.reduce((best, d) => ((d.profiles as Json[]).length > (best.profiles as Json[]).length ? d : best));
    return this.device;
  }

  private async brewerId(): Promise<string> {
    return String((await this.getDevice()).id);
  }

  async getProfiles(refresh = false): Promise<Json[]> {
    return ((await this.getDevice(refresh)).profiles as Json[]) ?? [];
  }

  async getSchedules(refresh = false): Promise<Json[]> {
    return ((await this.getDevice(refresh)).schedules as Json[]) ?? [];
  }

  async findProfile(id: string): Promise<Json> {
    const profiles = await this.getProfiles();
    const match = profiles.find((p) => p.id === id);
    if (!match) {
      const known = profiles.map((p) => `${p.id} (${p.title})`).join(", ") || "none";
      throw new FellowError(`No profile with id ${id}. Profiles on this brewer: ${known}`);
    }
    return match;
  }

  // ---- profiles ---------------------------------------------------------

  async createProfile(profile: Json): Promise<Json> {
    const created = await this.json("POST", `/devices/${await this.brewerId()}/profiles`, { profileType: 0, ...profile });
    if (!created || typeof created !== "object" || !("id" in created)) {
      throw new FellowError(`Fellow did not confirm the new profile: ${JSON.stringify(created).slice(0, 300)}`);
    }
    this.device = null;
    return created as Json;
  }

  async updateProfile(id: string, profile: Json): Promise<void> {
    await this.findProfile(id);
    await this.json("PATCH", `/devices/${await this.brewerId()}/profiles/${encodeURIComponent(id)}`, profile);
    this.device = null;
  }

  async deleteProfile(id: string): Promise<void> {
    await this.findProfile(id);
    await this.json("DELETE", `/devices/${await this.brewerId()}/profiles/${encodeURIComponent(id)}`);
    this.device = null;
  }

  async shareProfile(id: string): Promise<string> {
    await this.findProfile(id);
    const res = await this.json("POST", `/devices/${await this.brewerId()}/profiles/${encodeURIComponent(id)}/share`);
    if (!res?.link) throw new FellowError(`Fellow did not return a share link: ${JSON.stringify(res).slice(0, 300)}`);
    return String(res.link);
  }

  /** Read a profile someone shared as a brew.link URL (or bare code). */
  async readSharedProfile(link: string): Promise<Json> {
    const match = link.trim().match(/(?:.*?\/p\/)?([a-zA-Z0-9]+)\/?$/);
    if (!match) throw new FellowError("That doesn't look like a brew.link URL or code.");
    return (await this.json("GET", `/shared/${match[1]}`)) as Json;
  }

  // ---- schedules --------------------------------------------------------

  async createSchedule(schedule: Json): Promise<Json> {
    await this.findProfile(String(schedule.profileId));
    const created = await this.json("POST", `/devices/${await this.brewerId()}/schedules`, schedule);
    this.device = null;
    return created as Json;
  }

  private async findSchedule(id: string): Promise<Json> {
    const schedules = await this.getSchedules();
    const match = schedules.find((s) => s.id === id);
    if (!match) {
      const known = schedules.map((s) => s.id).join(", ") || "none";
      throw new FellowError(`No schedule with id ${id}. Schedules on this brewer: ${known}`);
    }
    return match;
  }

  async setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
    await this.findSchedule(id);
    await this.json("PATCH", `/devices/${await this.brewerId()}/schedules/${encodeURIComponent(id)}`, { enabled });
    this.device = null;
  }

  async deleteSchedule(id: string): Promise<void> {
    await this.findSchedule(id);
    await this.json("DELETE", `/devices/${await this.brewerId()}/schedules/${encodeURIComponent(id)}`);
    this.device = null;
  }
}
