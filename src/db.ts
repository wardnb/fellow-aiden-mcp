/**
 * The profile library: coffees, profile versions and tasting notes, kept in D1.
 *
 * The Aiden only holds what you're brewing now. Everything else lives here,
 * so the brewer menu stays short while nothing is ever lost.
 */
import type { Profile } from "./profile";

export interface DbEnv {
  DB: D1Database;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS coffees (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     roaster TEXT,
     origin TEXT,
     process TEXT,
     roast_level TEXT,
     variety TEXT,
     altitude TEXT,
     roast_date TEXT,
     bag_notes TEXT,
     status TEXT NOT NULL DEFAULT 'active',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS profiles (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     settings TEXT NOT NULL,
     coffee_id INTEGER REFERENCES coffees(id),
     parent_id INTEGER REFERENCES profiles(id),
     version INTEGER NOT NULL DEFAULT 1,
     change_note TEXT,
     grind_hint TEXT,
     source TEXT,
     aiden_id TEXT,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS tastings (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     profile_id INTEGER NOT NULL REFERENCES profiles(id),
     coffee_id INTEGER REFERENCES coffees(id),
     rating INTEGER CHECK (rating BETWEEN 1 AND 5),
     notes TEXT,
     grind TEXT,
     dose_g REAL,
     brew_mode TEXT,
     equipment TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS equipment (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     name TEXT NOT NULL,
     details TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS profiles_coffee ON profiles(coffee_id)`,
  `CREATE INDEX IF NOT EXISTS profiles_aiden ON profiles(aiden_id)`,
  `CREATE INDEX IF NOT EXISTS tastings_profile ON tastings(profile_id)`,
];

let schemaReady = false;

/**
 * Create tables on first use, so a one-click deploy needs no migration step.
 * Each request runs its own idempotent batch until one succeeds; no promise is
 * shared across requests.
 */
export async function ensureSchema(db: D1Database) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  schemaReady = true;
}

export interface CoffeeInput {
  name: string;
  roaster?: string;
  origin?: string;
  process?: string;
  roast_level?: string;
  variety?: string;
  altitude?: string;
  roast_date?: string;
  bag_notes?: string;
}

export class Library {
  constructor(private readonly db: D1Database) {}

  private async init() {
    await ensureSchema(this.db);
  }

  // ---- coffees ----------------------------------------------------------

  async addCoffee(c: CoffeeInput) {
    await this.init();
    return this.db
      .prepare(
        `INSERT INTO coffees (name, roaster, origin, process, roast_level, variety, altitude, roast_date, bag_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(c.name, c.roaster ?? null, c.origin ?? null, c.process ?? null, c.roast_level ?? null, c.variety ?? null, c.altitude ?? null, c.roast_date ?? null, c.bag_notes ?? null)
      .first();
  }

  async setCoffeeStatus(id: number, status: "active" | "finished") {
    await this.init();
    const row = await this.db.prepare(`UPDATE coffees SET status = ? WHERE id = ? RETURNING *`).bind(status, id).first();
    if (!row) throw new Error(`No coffee with id ${id}.`);
    return row;
  }

  async listCoffees(status?: "active" | "finished") {
    await this.init();
    const sql = `SELECT c.*,
        (SELECT COUNT(*) FROM profiles p WHERE p.coffee_id = c.id AND p.archived = 0) AS profiles,
        (SELECT ROUND(AVG(rating), 1) FROM tastings t WHERE t.coffee_id = c.id) AS avg_rating
      FROM coffees c ${status ? "WHERE c.status = ?" : ""} ORDER BY c.created_at DESC`;
    const stmt = status ? this.db.prepare(sql).bind(status) : this.db.prepare(sql);
    return (await stmt.all()).results;
  }

  async getCoffee(id: number) {
    await this.init();
    const row = await this.db.prepare(`SELECT * FROM coffees WHERE id = ?`).bind(id).first();
    if (!row) throw new Error(`No coffee with id ${id}.`);
    return row;
  }

  // ---- profiles ---------------------------------------------------------

  async saveProfile(p: {
    settings: Profile;
    coffeeId?: number;
    parentId?: number;
    changeNote?: string;
    grindHint?: string;
    source?: string;
  }) {
    await this.init();
    let version = 1;
    let coffeeId = p.coffeeId ?? null;
    let grindHint = p.grindHint ?? null;
    if (p.parentId) {
      const parent = await this.getProfileRow(p.parentId);
      version = Number(parent.version) + 1;
      coffeeId ??= (parent.coffee_id as number | null) ?? null;
      grindHint ??= (parent.grind_hint as string | null) ?? null;
    }
    if (coffeeId) await this.getCoffee(coffeeId);
    return this.db
      .prepare(
        `INSERT INTO profiles (title, settings, coffee_id, parent_id, version, change_note, grind_hint, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, title, version, coffee_id, parent_id, grind_hint`,
      )
      .bind(p.settings.title, JSON.stringify(p.settings), coffeeId, p.parentId ?? null, version, p.changeNote ?? null, grindHint, p.source ?? null)
      .first();
  }

  async getProfileRow(id: number) {
    await this.init();
    const row = await this.db.prepare(`SELECT * FROM profiles WHERE id = ?`).bind(id).first();
    if (!row) throw new Error(`No library profile with id ${id}.`);
    return row as Record<string, unknown>;
  }

  async getProfileFull(id: number) {
    const row = await this.getProfileRow(id);
    const [coffee, tastings, lineage, children] = await Promise.all([
      row.coffee_id ? this.db.prepare(`SELECT * FROM coffees WHERE id = ?`).bind(row.coffee_id).first() : null,
      this.db.prepare(`SELECT id, rating, notes, grind, dose_g, brew_mode, equipment, created_at FROM tastings WHERE profile_id = ? ORDER BY created_at DESC`).bind(id).all(),
      this.lineage(id),
      this.db.prepare(`SELECT id, title, version, change_note FROM profiles WHERE parent_id = ?`).bind(id).all(),
    ]);
    return {
      id: row.id,
      title: row.title,
      version: row.version,
      changeNote: row.change_note,
      grindHint: row.grind_hint,
      source: row.source,
      onBrewer: row.aiden_id ? { aidenId: row.aiden_id } : false,
      archived: !!row.archived,
      createdAt: row.created_at,
      settings: JSON.parse(String(row.settings)),
      coffee,
      tastings: tastings.results.map((t: any) => ({ ...t, equipment: t.equipment ? JSON.parse(t.equipment) : null })),
      history: lineage,
      laterVersions: children.results,
    };
  }

  /** Earlier versions of a profile, oldest first, with their tasting averages. */
  private async lineage(id: number) {
    const rows = await this.db
      .prepare(
        `WITH RECURSIVE chain(id, parent_id, depth) AS (
           SELECT id, parent_id, 0 FROM profiles WHERE id = ?
           UNION ALL SELECT p.id, p.parent_id, c.depth + 1 FROM profiles p JOIN chain c ON p.id = c.parent_id
         )
         SELECT p.id, p.version, p.change_note, p.settings,
           (SELECT ROUND(AVG(rating), 1) FROM tastings t WHERE t.profile_id = p.id) AS avg_rating,
           (SELECT GROUP_CONCAT(notes, ' | ') FROM tastings t WHERE t.profile_id = p.id) AS notes
         FROM chain c JOIN profiles p ON p.id = c.id WHERE c.depth > 0 ORDER BY c.depth DESC`,
      )
      .bind(id)
      .all();
    return rows.results.map((r: any) => ({ ...r, settings: JSON.parse(r.settings) }));
  }

  async search(q: {
    text?: string;
    coffeeId?: number;
    minRating?: number;
    onBrewer?: boolean;
    includeArchived?: boolean;
    limit?: number;
  }) {
    await this.init();
    const where: string[] = [];
    const args: unknown[] = [];
    if (!q.includeArchived) where.push("p.archived = 0");
    if (q.coffeeId) {
      where.push("p.coffee_id = ?");
      args.push(q.coffeeId);
    }
    if (q.onBrewer !== undefined) where.push(q.onBrewer ? "p.aiden_id IS NOT NULL" : "p.aiden_id IS NULL");
    if (q.text) {
      // Every word must appear somewhere: title, change note, coffee details or tasting notes.
      const cols = ["p.title", "p.change_note", "c.name", "c.roaster", "c.origin", "c.process", "c.variety", "c.bag_notes", "c.roast_level"];
      for (const word of q.text.split(/\s+/).filter(Boolean).slice(0, 8)) {
        const like = `%${word.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
        const ors = cols.map((col) => `${col} LIKE ? ESCAPE '\\'`);
        ors.push(`EXISTS (SELECT 1 FROM tastings tn WHERE tn.profile_id = p.id AND tn.notes LIKE ? ESCAPE '\\')`);
        where.push(`(${ors.join(" OR ")})`);
        for (let i = 0; i < ors.length; i++) args.push(like);
      }
    }
    const having = q.minRating ? "HAVING avg_rating >= ?" : "";
    if (q.minRating) args.push(q.minRating);
    args.push(Math.min(q.limit ?? 25, 100));
    const sql = `SELECT p.id, p.title, p.version, p.aiden_id, p.archived, p.created_at,
        c.id AS coffee_id, c.name AS coffee, c.roaster, c.origin, c.process, c.roast_level,
        ROUND(AVG(t.rating), 1) AS avg_rating, COUNT(t.id) AS tastings
      FROM profiles p LEFT JOIN coffees c ON c.id = p.coffee_id LEFT JOIN tastings t ON t.profile_id = p.id
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      GROUP BY p.id ${having}
      ORDER BY (p.aiden_id IS NOT NULL) DESC, avg_rating IS NULL, avg_rating DESC, p.created_at DESC
      LIMIT ?`;
    return (await this.db.prepare(sql).bind(...args).all()).results;
  }

  async setArchived(id: number, archived: boolean) {
    await this.init();
    await this.getProfileRow(id);
    await this.db.prepare(`UPDATE profiles SET archived = ? WHERE id = ?`).bind(archived ? 1 : 0, id).run();
  }

  async setAidenId(id: number, aidenId: string | null) {
    await this.init();
    if (aidenId) await this.db.prepare(`UPDATE profiles SET aiden_id = NULL WHERE aiden_id = ?`).bind(aidenId).run();
    await this.db.prepare(`UPDATE profiles SET aiden_id = ? WHERE id = ?`).bind(aidenId, id).run();
  }

  /**
   * Library entries currently on the brewer, keyed by Aiden id, after dropping stale links.
   *
   * Aiden ids (p3, p4…) are reused once a profile is deleted, including deletions made
   * in the Fellow app. A link only counts if that id is still on the brewer with the
   * same title; otherwise it's cleared so we never act on someone else's profile.
   */
  async links(brewerProfiles: { id?: unknown; title?: unknown }[]) {
    await this.init();
    const onBrewer = new Map(brewerProfiles.map((p) => [String(p.id), String(p.title ?? "")]));
    const rows = (await this.db.prepare(`SELECT id, title, version, aiden_id FROM profiles WHERE aiden_id IS NOT NULL`).all()).results as any[];
    const valid = new Map<string, any>();
    const stale: number[] = [];
    for (const r of rows) {
      const aidenId = String(r.aiden_id);
      if (onBrewer.get(aidenId) === r.title && !valid.has(aidenId)) valid.set(aidenId, r);
      else stale.push(r.id);
    }
    if (stale.length) {
      await this.db.batch(stale.map((id) => this.db.prepare(`UPDATE profiles SET aiden_id = NULL WHERE id = ?`).bind(id)));
    }
    return valid;
  }

  // ---- tastings ---------------------------------------------------------

  async logTasting(t: { profileId: number; rating?: number; notes?: string; grind?: string; doseG?: number; brewMode?: string }) {
    const row = await this.getProfileRow(t.profileId);
    // Snapshot the gear in use, so old notes still make sense after a grinder or filter swap.
    const setup = (await this.listEquipment(false)).map((e: any) => ({ kind: e.kind, name: e.name, details: e.details }));
    const saved = (await this.db
      .prepare(
        `INSERT INTO tastings (profile_id, coffee_id, rating, notes, grind, dose_g, brew_mode, equipment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(t.profileId, row.coffee_id ?? null, t.rating ?? null, t.notes ?? null, t.grind ?? null, t.doseG ?? null, t.brewMode ?? null, setup.length ? JSON.stringify(setup) : null)
      .first()) as any;
    return { ...saved, equipment: setup };
  }

  // ---- equipment --------------------------------------------------------

  async addEquipment(e: { kind: string; name: string; details?: string }) {
    await this.init();
    return this.db
      .prepare(`INSERT INTO equipment (kind, name, details) VALUES (?, ?, ?) RETURNING *`)
      .bind(e.kind, e.name, e.details ?? null)
      .first();
  }

  async updateEquipment(id: number, e: { name?: string; details?: string; active?: boolean }) {
    await this.init();
    const row = await this.db
      .prepare(
        `UPDATE equipment SET name = COALESCE(?, name), details = COALESCE(?, details), active = COALESCE(?, active)
         WHERE id = ? RETURNING *`,
      )
      .bind(e.name ?? null, e.details ?? null, e.active === undefined ? null : e.active ? 1 : 0, id)
      .first();
    if (!row) throw new Error(`No equipment with id ${id}.`);
    return row;
  }

  async listEquipment(includeRetired: boolean) {
    await this.init();
    const sql = `SELECT * FROM equipment ${includeRetired ? "" : "WHERE active = 1"} ORDER BY kind, created_at`;
    return (await this.db.prepare(sql).all()).results;
  }
}
