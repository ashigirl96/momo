import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./index.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "momo-db-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const mode = (path: string) => statSync(path).mode & 0o777;

test("opens with foreign keys and secure_delete on, and keeps the database files owner-only", () => {
  const path = join(root, "app.db");
  const db = openDatabase(path);
  db.run("CREATE TABLE t (x)");
  db.run("INSERT INTO t VALUES (1)");

  expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  expect(db.query("PRAGMA secure_delete").get()).toEqual({ secure_delete: 1 });
  expect(db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  for (const file of [path, `${path}-wal`, `${path}-shm`]) expect(mode(file)).toBe(0o600);
  db.close();
});
