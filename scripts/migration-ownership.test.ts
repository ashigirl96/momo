import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationOwnershipProblems, repoMigrationDirs } from "./migration-ownership.ts";

const root = mkdtempSync(join(tmpdir(), "momo-ownership-"));
afterEach(() => rmSync(root, { recursive: true, force: true }));

function domain(name: string, migrations: Record<string, string>) {
  const dir = join(root, name);
  for (const [folder, sql] of Object.entries(migrations)) {
    mkdirSync(join(dir, folder), { recursive: true });
    writeFileSync(join(dir, folder, "migration.sql"), sql);
  }
  return { domain: name, dir };
}

test("every domain's migrations in this repo touch only the tables that domain creates", () => {
  expect(migrationOwnershipProblems(repoMigrationDirs())).toEqual([]);
});

test("a migration that creates, drops or alters another domain's table is reported", () => {
  const workspace = domain("workspace", {
    "1_bots":
      "CREATE TABLE `bots` (`id` text);\n--> statement-breakpoint\nCREATE INDEX `bots_id` ON `bots` (`id`);",
  });
  const agent = domain("agent", {
    "1_runs": [
      "CREATE TABLE `runs` (`id` text);",
      "DROP TABLE `bots`;",
      "CREATE TABLE `bots` (`id` text);",
      "ALTER TABLE `bots` ADD `x` text;",
      "CREATE TRIGGER `t` AFTER INSERT ON `bots` BEGIN SELECT 1; END;",
      "CREATE INDEX `runs_id` ON `runs` (`id`);",
      "ALTER TABLE `runs` ADD `y` text;",
    ].join("\n--> statement-breakpoint\n"),
  });

  expect(migrationOwnershipProblems([workspace, agent])).toEqual([
    "agent/1_runs: DROP TABLE `bots` is owned by workspace",
    "agent/1_runs: CREATE TABLE `bots` is owned by workspace",
    "agent/1_runs: ALTER TABLE `bots` is owned by workspace",
    "agent/1_runs: CREATE TRIGGER `bots` is owned by workspace",
  ]);
});

test("drizzle's table recreate through __new_<table> counts as the domain's own table", () => {
  const agent = domain("agent", {
    "1_runs": "CREATE TABLE `runs` (`id` text);",
    "2_recreate": [
      "CREATE TABLE `__new_runs` (`id` text);",
      "INSERT INTO `__new_runs` SELECT * FROM `runs`;",
      "DROP TABLE `runs`;",
      "ALTER TABLE `__new_runs` RENAME TO `runs`;",
    ].join("\n--> statement-breakpoint\n"),
  });

  expect(migrationOwnershipProblems([agent])).toEqual([]);
});
