import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.ts";
import { migrate, type MigrationSource } from "./index.ts";

export type TestDatabase = {
  sqlite: Database;
  path: string;
  /** Closes and reopens the file, as a backend restart would. */
  reopen(): Database;
  close(): void;
};

/**
 * A temporary app.db with the real migrations of the given domains applied.
 */
export function migratedTestDatabase(sources: MigrationSource[]): TestDatabase {
  const dir = mkdtempSync(join(tmpdir(), "momo-test-db-"));
  const path = join(dir, "app.db");
  const handle: TestDatabase = {
    sqlite: openDatabase(path),
    path,
    reopen() {
      handle.sqlite.close();
      handle.sqlite = openDatabase(path);
      return handle.sqlite;
    },
    close() {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  migrate(handle.sqlite, sources);
  return handle;
}
