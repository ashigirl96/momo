import { Database } from "bun:sqlite";
import type { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core";
import { chmodSync, closeSync, openSync } from "node:fs";

/** A Drizzle database or transaction over bun:sqlite; domain functions accept either. */
// oxlint-disable-next-line typescript/no-explicit-any
export type Db = SQLiteAsyncDatabase<"sync", any, any>;

export function openDatabase(path: string): Database {
  // SQLite creates -wal and -shm with the main file's mode, and the umask covers the first create.
  const previous = process.umask(0o077);
  try {
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
    const db = new Database(path);
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA busy_timeout=5000");
    db.run("PRAGMA foreign_keys=ON");
    // secure_delete is per connection and defaults to FAST on the macOS build of SQLite.
    db.run("PRAGMA secure_delete=ON");
    return db;
  } finally {
    process.umask(previous);
  }
}
