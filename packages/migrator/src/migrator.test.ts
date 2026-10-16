import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, MigrationError, type MigrationSource } from "./index.ts";

let root: string;
let db: Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "momo-migrator-"));
  db = new Database(join(root, "app.db"));
  db.run("PRAGMA foreign_keys=ON");
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function domain(name: string, migrations: Record<string, string>): MigrationSource {
  const dir = join(root, name, "migrations");
  for (const [folder, sql] of Object.entries(migrations)) {
    mkdirSync(join(dir, folder), { recursive: true });
    writeFileSync(join(dir, folder, "migration.sql"), sql);
  }
  mkdirSync(dir, { recursive: true });
  return { domain: name, dir };
}

function history() {
  return db.query("SELECT domain, name FROM momo_migrations ORDER BY rowid").all();
}

function tables() {
  return db
    .query("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => (r as { name: string }).name);
}

describe("migrate", () => {
  test("builds an empty database from every domain and records history per domain", () => {
    const workspace = domain("workspace", {
      "20260101000000_init": "CREATE TABLE `workspaces` (`id` text PRIMARY KEY NOT NULL);",
    });
    const agent = domain("agent", {
      "20260102000000_init":
        "CREATE TABLE `sessions` (`id` text PRIMARY KEY NOT NULL, `workspace_id` text NOT NULL REFERENCES `workspaces`(`id`));",
    });

    const result = migrate(db, [workspace, agent]);

    expect(result.applied).toEqual([
      { domain: "workspace", name: "20260101000000_init" },
      { domain: "agent", name: "20260102000000_init" },
    ]);
    expect(tables()).toEqual(["momo_migrations", "sessions", "workspaces"]);
    expect(history()).toEqual([
      { domain: "workspace", name: "20260101000000_init" },
      { domain: "agent", name: "20260102000000_init" },
    ]);
  });

  test("re-running applies nothing and runs no DDL twice", () => {
    const sources = [
      domain("workspace", {
        "20260101000000_init": "CREATE TABLE `workspaces` (`id` text PRIMARY KEY NOT NULL);",
      }),
    ];
    migrate(db, sources);

    expect(migrate(db, sources).applied).toEqual([]);
    expect(history()).toHaveLength(1);
  });

  test("keeps identical folder names in different domains apart", () => {
    const sources = [
      domain("workspace", { "20260101000000_fts": "CREATE TABLE `a` (`id` integer);" }),
      domain("agent", { "20260101000000_fts": "CREATE TABLE `b` (`id` integer);" }),
    ];

    const result = migrate(db, sources);

    expect(result.applied).toEqual([
      { domain: "agent", name: "20260101000000_fts" },
      { domain: "workspace", name: "20260101000000_fts" },
    ]);
    expect(tables()).toEqual(["a", "b", "momo_migrations"]);
  });

  test("orders by timestamp across domains, not by domain or by name", () => {
    const sources = [
      domain("agent", {
        "20260103000000_aaa": "ALTER TABLE `t` ADD `third` integer;",
        "20260101000000_zzz": "CREATE TABLE `t` (`id` integer);",
      }),
      domain("workspace", { "20260102000000_init": "ALTER TABLE `t` ADD `second` integer;" }),
    ];

    expect(migrate(db, sources).applied).toEqual([
      { domain: "agent", name: "20260101000000_zzz" },
      { domain: "workspace", name: "20260102000000_init" },
      { domain: "agent", name: "20260103000000_aaa" },
    ]);
  });

  test("applies a late-merged migration whose timestamp is older than applied ones", () => {
    const workspace = domain("workspace", {
      "20260105000000_init": "CREATE TABLE `workspaces` (`id` text PRIMARY KEY NOT NULL);",
    });
    migrate(db, [workspace]);
    const agent = domain("agent", { "20260101000000_early": "CREATE TABLE `early` (`id` integer);" });

    expect(migrate(db, [workspace, agent]).applied).toEqual([
      { domain: "agent", name: "20260101000000_early" },
    ]);
  });

  test("runs statements split by drizzle-kit breakpoints and skips comment-only chunks", () => {
    const sources = [
      domain("memory", {
        "20260101000000_init":
          "CREATE TABLE `a` (`id` integer);--> statement-breakpoint\nCREATE TABLE `b` (`id` integer);",
        "20260101000001_custom": "-- Custom SQL migration file, put your code below! --\n",
      }),
    ];

    expect(migrate(db, sources).applied).toHaveLength(2);
    expect(tables()).toEqual(["a", "b", "momo_migrations"]);
  });

  test("refuses to start when an applied migration's hash changed", () => {
    const dir = domain("workspace", { "20260101000000_init": "CREATE TABLE `a` (`id` integer);" });
    migrate(db, [dir]);
    writeFileSync(
      join(dir.dir, "20260101000000_init", "migration.sql"),
      "CREATE TABLE `a` (`id` integer, `x` integer);",
    );
    domain("workspace", { "20260102000000_next": "CREATE TABLE `b` (`id` integer);" });

    expect(() => migrate(db, [dir])).toThrow(
      expect.objectContaining({
        kind: "hash_mismatch",
        domain: "workspace",
        migration: "20260101000000_init",
      }),
    );
    expect(tables()).not.toContain("b");
  });

  test("refuses to start when the database has a migration the binary lacks (downgrade)", () => {
    const newer = domain("workspace", {
      "20260101000000_init": "CREATE TABLE `a` (`id` integer);",
      "20260102000000_next": "CREATE TABLE `b` (`id` integer);",
    });
    migrate(db, [newer]);
    rmSync(join(newer.dir, "20260102000000_next"), { recursive: true });

    expect(() => migrate(db, [newer])).toThrow(
      expect.objectContaining({
        kind: "unknown_migration",
        domain: "workspace",
        migration: "20260102000000_next",
      }),
    );
  });

  test("rolls back a failing migration, keeps earlier ones, and reports the failure", () => {
    const sources = [
      domain("workspace", {
        "20260101000000_init": "CREATE TABLE `a` (`id` integer);",
        "20260102000000_bad":
          "CREATE TABLE `b` (`id` integer);--> statement-breakpoint\nINSERT INTO `nope` VALUES (1);",
        "20260103000000_after": "CREATE TABLE `c` (`id` integer);",
      }),
    ];

    let error: unknown;
    try {
      migrate(db, sources);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({
      kind: "apply_failed",
      domain: "workspace",
      migration: "20260102000000_bad",
    });
    expect(tables()).toEqual(["a", "momo_migrations"]);
    expect(history()).toEqual([{ domain: "workspace", name: "20260101000000_init" }]);
  });

  test("rolls back a migration that leaves a foreign key violation", () => {
    const sources = [
      domain("workspace", {
        "20260101000000_init":
          "CREATE TABLE `p` (`id` integer PRIMARY KEY);--> statement-breakpoint\nCREATE TABLE `c` (`id` integer, `p` integer REFERENCES `p`(`id`));",
        "20260102000000_orphan": "INSERT INTO `c` VALUES (1, 42);",
      }),
    ];

    expect(() => migrate(db, sources)).toThrow(
      expect.objectContaining({ kind: "foreign_key_violation", migration: "20260102000000_orphan" }),
    );
    expect(db.query("SELECT count(*) AS n FROM c").get()).toEqual({ n: 0 });
  });

  test("a table recreate keeps child rows that reference it with ON DELETE CASCADE", () => {
    const sources = [
      domain("workspace", {
        "20260101000000_init": [
          "CREATE TABLE `bots` (`workspace_id` text NOT NULL, `id` text NOT NULL, `name` text, `note` text, CONSTRAINT `bots_pk` PRIMARY KEY(`workspace_id`, `id`));",
          "CREATE TABLE `conversations` (`workspace_id` text NOT NULL, `id` text NOT NULL, `bot_id` text NOT NULL, CONSTRAINT `conversations_pk` PRIMARY KEY(`workspace_id`, `id`), CONSTRAINT `fk_conv_bot` FOREIGN KEY (`workspace_id`, `bot_id`) REFERENCES `bots`(`workspace_id`, `id`) ON DELETE CASCADE);",
        ].join("--> statement-breakpoint\n"),
      }),
    ];
    migrate(db, sources);
    db.run("INSERT INTO bots VALUES ('w1', 'b1', 'B', 'n')");
    db.run("INSERT INTO conversations VALUES ('w1', 'c1', 'b1')");
    // The exact statements drizzle-kit 1.0.0-rc.4 emits when a column is dropped from `bots`.
    domain("workspace", {
      "20260102000000_recreate": [
        "PRAGMA foreign_keys=OFF;",
        "CREATE TABLE `__new_bots` (`workspace_id` text NOT NULL, `id` text NOT NULL, `name` text, CONSTRAINT `bots_pk` PRIMARY KEY(`workspace_id`, `id`));",
        "INSERT INTO `__new_bots`(`workspace_id`, `id`, `name`) SELECT `workspace_id`, `id`, `name` FROM `bots`;",
        "DROP TABLE `bots`;",
        "ALTER TABLE `__new_bots` RENAME TO `bots`;",
        "PRAGMA foreign_keys=ON;",
      ].join("--> statement-breakpoint\n"),
    });

    migrate(db, sources);

    expect(db.query("SELECT id FROM conversations").all()).toEqual([{ id: "c1" }]);
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  test("drops a parent table before its child (drizzle-orm#6251 order) without failing", () => {
    const sources = [
      domain("workspace", {
        "20260101000000_init": [
          "CREATE TABLE `aaa_parent` (`id` integer PRIMARY KEY);",
          "CREATE TABLE `zzz_child` (`id` integer PRIMARY KEY, `p` integer REFERENCES `aaa_parent`(`id`));",
        ].join("--> statement-breakpoint\n"),
      }),
    ];
    migrate(db, sources);
    db.run("INSERT INTO aaa_parent VALUES (1)");
    db.run("INSERT INTO zzz_child VALUES (1, 1)");
    domain("workspace", {
      "20260102000000_drop": "DROP TABLE `aaa_parent`;--> statement-breakpoint\nDROP TABLE `zzz_child`;",
    });

    migrate(db, sources);

    expect(tables()).toEqual(["momo_migrations"]);
  });
});
