import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export { openDatabase, type Db } from "./database.ts";

export type MigrationSource = {
  domain: string;
  dir: string;
};

export type MigrationRef = {
  domain: string;
  name: string;
};

export type MigrationErrorKind =
  | "hash_mismatch"
  | "unknown_migration"
  | "apply_failed"
  | "foreign_key_violation"
  | "invalid_name";

export class MigrationError extends Error {
  readonly kind: MigrationErrorKind;
  readonly domain: string;
  readonly migration: string;

  constructor(kind: MigrationErrorKind, ref: MigrationRef, detail: string, options?: ErrorOptions) {
    super(`migration ${ref.domain}/${ref.name}: ${kind}: ${detail}`, options);
    this.name = "MigrationError";
    this.kind = kind;
    this.domain = ref.domain;
    this.migration = ref.name;
  }
}

type Migration = MigrationRef & {
  timestamp: string;
  sql: string;
  hash: string;
};

const FOLDER = /^(\d{14})_[A-Za-z0-9_-]+$/;
const BREAKPOINT = "--> statement-breakpoint";

function loadMigrations(sources: MigrationSource[]): Migration[] {
  const migrations: Migration[] = [];
  for (const { domain, dir } of sources) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const ref = { domain, name: entry.name };
      const match = FOLDER.exec(entry.name);
      if (!match) throw new MigrationError("invalid_name", ref, "folder must be <YYYYMMDDHHMMSS>_<name>");
      const bytes = readFileSync(join(dir, entry.name, "migration.sql"));
      migrations.push({
        ...ref,
        timestamp: match[1]!,
        sql: bytes.toString("utf8"),
        hash: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return migrations.toSorted(
    (a, b) => compare(a.timestamp, b.timestamp) || compare(a.domain, b.domain) || compare(a.name, b.name),
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function statements(sql: string): string[] {
  return sql
    .split(BREAKPOINT)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.replace(/--.*$/gm, "").trim() !== "");
}

function ensureHistoryTable(db: Database) {
  db.run(`CREATE TABLE IF NOT EXISTS momo_migrations (
    domain text NOT NULL,
    name text NOT NULL,
    hash text NOT NULL,
    applied_at integer NOT NULL,
    PRIMARY KEY (domain, name)
  )`);
}

type HistoryRow = { domain: string; name: string; hash: string };

function readHistory(db: Database): Map<string, HistoryRow> {
  const rows = db.query<HistoryRow, []>("SELECT domain, name, hash FROM momo_migrations").all();
  return new Map(rows.map((row) => [key(row), row]));
}

function key(ref: MigrationRef): string {
  return `${ref.domain}\u0000${ref.name}`;
}

function verifyHistory(history: Map<string, HistoryRow>, migrations: Migration[]) {
  const known = new Map(migrations.map((m) => [key(m), m]));
  for (const row of history.values()) {
    const migration = known.get(key(row));
    if (!migration)
      throw new MigrationError(
        "unknown_migration",
        row,
        "applied in the database but missing from this build",
      );
    if (migration.hash !== row.hash)
      throw new MigrationError("hash_mismatch", row, "migration.sql changed after it was applied");
  }
}

/** One transaction per migration; throws MigrationError when the database must not be used. */
export function migrate(db: Database, sources: MigrationSource[]): { applied: MigrationRef[] } {
  const migrations = loadMigrations(sources);
  ensureHistoryTable(db);
  verifyHistory(readHistory(db), migrations);

  const applied: MigrationRef[] = [];
  for (const migration of migrations) {
    if (applyOne(db, migration)) applied.push({ domain: migration.domain, name: migration.name });
  }
  return { applied };
}

function applyOne(db: Database, migration: Migration): boolean {
  const ref = { domain: migration.domain, name: migration.name };
  // PRAGMA foreign_keys is a no-op inside a transaction, so a table recreate would cascade.
  db.run("PRAGMA foreign_keys=OFF");
  try {
    db.run("BEGIN IMMEDIATE");
    try {
      // Re-read under the write lock so a concurrent runner cannot apply the same migration twice.
      const done = readHistory(db).get(key(ref));
      if (done) {
        db.run("ROLLBACK");
        if (done.hash !== migration.hash)
          throw new MigrationError("hash_mismatch", ref, "applied concurrently with a different hash");
        return false;
      }
      for (const statement of statements(migration.sql)) db.run(statement);
      const violations = db.query("PRAGMA foreign_key_check").all();
      if (violations.length > 0) {
        throw new MigrationError("foreign_key_violation", ref, JSON.stringify(violations.slice(0, 5)));
      }
      db.run("INSERT INTO momo_migrations (domain, name, hash, applied_at) VALUES (?, ?, ?, ?)", [
        migration.domain,
        migration.name,
        migration.hash,
        Date.now(),
      ]);
      db.run("COMMIT");
      return true;
    } catch (error) {
      if (db.inTransaction) db.run("ROLLBACK");
      if (error instanceof MigrationError) throw error;
      throw new MigrationError("apply_failed", ref, String(error), { cause: error });
    }
  } finally {
    db.run("PRAGMA foreign_keys=ON");
  }
}
