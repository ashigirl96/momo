import { afterEach, beforeEach, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import { migrations } from "./index.ts";
import { workspaceOwnedTableProblems } from "./testing.ts";

let testDb: TestDatabase;

beforeEach(() => {
  testDb = migratedTestDatabase([migrations]);
});

afterEach(() => {
  testDb.close();
});

test("flags a Workspace-owned table that skips the rules", () => {
  testDb.sqlite.run(
    "CREATE TABLE parents (id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), UNIQUE (workspace_id, id))",
  );
  testDb.sqlite.run(`CREATE TRIGGER parents_lock BEFORE UPDATE OF \`workspace_id\` ON parents
    BEGIN SELECT RAISE(ABORT, 'workspace_id is immutable'); END`);
  testDb.sqlite.run(
    "CREATE TABLE loose (id text PRIMARY KEY, workspace_id text, parent_id text REFERENCES parents(id))",
  );

  expect(workspaceOwnedTableProblems(testDb.sqlite)).toEqual([
    "loose: workspace_id is nullable",
    "loose: workspace_id does not reference workspaces(id)",
    "loose: references parents without (workspace_id, id)",
    "loose: no UNIQUE (workspace_id, id)",
    "loose: workspace_id can be updated",
  ]);
});
