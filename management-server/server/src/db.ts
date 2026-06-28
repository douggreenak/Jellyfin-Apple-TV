import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DEFAULT_TEMPLATE } from "./defaults";
import type { UnitConfig } from "./schema";

/** Raw row stored in the `units` table (all blobs are JSON strings). */
export interface UnitRow {
  unitId: string;
  displayName: string;
  groupId: string | null;
  config: string;
  status: string;
  pendingCommand: string | null;
  deviceToken: string | null;
  configVersion: number;
  registeredAt: string;
  adopted: number; // 0 = pending/ready-to-adopt, 1 = adopted (SQLite has no bool)
}

let db: Database.Database;

const DEFAULTS_KEY = "defaultsTemplate";

/** Open the DB, create tables, and seed the defaults template if absent. */
export function initDb(dbPath: string): Database.Database {
  const abs = resolve(dbPath);
  mkdirSync(dirname(abs), { recursive: true });

  db = new Database(abs);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      unitId         TEXT PRIMARY KEY,
      displayName    TEXT NOT NULL,
      groupId        TEXT,
      config         TEXT NOT NULL,
      status         TEXT NOT NULL,
      pendingCommand TEXT,
      deviceToken    TEXT,
      configVersion  INTEGER NOT NULL,
      registeredAt   TEXT NOT NULL,
      adopted        INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate older databases that predate the `adopted` column.
  try {
    db.exec("ALTER TABLE units ADD COLUMN adopted INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists — nothing to do.
  }

  // Seed the defaults template row if missing.
  const existing = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(DEFAULTS_KEY);
  if (!existing) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      DEFAULTS_KEY,
      JSON.stringify(DEFAULT_TEMPLATE)
    );
  }

  // Migration: the per-unit `security` (settings PIN) feature was removed. Strip it
  // from any stored unit configs and the defaults template so they validate against
  // the current (strict) schema. Idempotent — only rewrites rows that still have it.
  stripDroppedConfigKeys(db);

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

/** Remove config keys that have been dropped from the schema (currently `security`). */
function stripDroppedConfigKeys(database: Database.Database): void {
  const DROPPED = ["security"];
  const strip = (json: string): string | null => {
    const obj = JSON.parse(json) as Record<string, unknown>;
    let changed = false;
    for (const key of DROPPED) {
      if (key in obj) {
        delete obj[key];
        changed = true;
      }
    }
    return changed ? JSON.stringify(obj) : null;
  };

  // Defaults template.
  const tmpl = database
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(DEFAULTS_KEY) as { value: string } | undefined;
  if (tmpl) {
    const next = strip(tmpl.value);
    if (next) {
      database
        .prepare("UPDATE settings SET value = ? WHERE key = ?")
        .run(next, DEFAULTS_KEY);
    }
  }

  // Every unit's config.
  const rows = database.prepare("SELECT unitId, config FROM units").all() as {
    unitId: string;
    config: string;
  }[];
  const update = database.prepare("UPDATE units SET config = ? WHERE unitId = ?");
  for (const row of rows) {
    const next = strip(row.config);
    if (next) update.run(next, row.unitId);
  }
}

/* ----------------------------- Units helpers ----------------------------- */

export function getUnitRow(unitId: string): UnitRow | undefined {
  return getDb()
    .prepare("SELECT * FROM units WHERE unitId = ?")
    .get(unitId) as UnitRow | undefined;
}

export function listUnitRows(): UnitRow[] {
  return getDb()
    .prepare("SELECT * FROM units ORDER BY displayName COLLATE NOCASE ASC")
    .all() as UnitRow[];
}

export function insertUnitRow(row: UnitRow): void {
  getDb()
    .prepare(
      `INSERT INTO units
        (unitId, displayName, groupId, config, status, pendingCommand, deviceToken, configVersion, registeredAt, adopted)
       VALUES
        (@unitId, @displayName, @groupId, @config, @status, @pendingCommand, @deviceToken, @configVersion, @registeredAt, @adopted)`
    )
    .run(row);
}

export function updateUnitRow(row: UnitRow): void {
  getDb()
    .prepare(
      `UPDATE units SET
        displayName    = @displayName,
        groupId        = @groupId,
        config         = @config,
        status         = @status,
        pendingCommand = @pendingCommand,
        deviceToken    = @deviceToken,
        configVersion  = @configVersion,
        registeredAt   = @registeredAt,
        adopted        = @adopted
       WHERE unitId = @unitId`
    )
    .run(row);
}

export function deleteUnitRow(unitId: string): boolean {
  const info = getDb().prepare("DELETE FROM units WHERE unitId = ?").run(unitId);
  return info.changes > 0;
}

/* --------------------------- Defaults template --------------------------- */

export function getDefaultsTemplate(): UnitConfig {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(DEFAULTS_KEY) as { value: string } | undefined;
  if (!row) return JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)) as UnitConfig;
  return JSON.parse(row.value) as UnitConfig;
}

export function putDefaultsTemplate(template: UnitConfig): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(DEFAULTS_KEY, JSON.stringify(template));
}

/* ------------------------------ Settings KV ------------------------------ */

/** Read a raw value from the settings key-value table. */
export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

/** Upsert a raw value into the settings key-value table. */
export function putSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}
