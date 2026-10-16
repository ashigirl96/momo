import { afterEach, expect, test } from "bun:test";
import { migrations as agentMigrations } from "@momo/agent";
import { migrate, openDatabase } from "@momo/migrator";
import {
  createBot,
  createWorkspace,
  resolveWorkspaceScope,
  migrations as workspaceMigrations,
} from "@momo/workspace";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrations } from "./index.ts";
import { searchMemoryItems } from "./items.ts";

const dir = mkdtempSync(join(tmpdir(), "momo-fts-backfill-"));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("Memory items written before the full-text index existed are found once it is added", () => {
  const before = join(dir, "memory");
  const first = "20261016132026_memory_items";
  cpSync(join(migrations.dir, first), join(before, first), { recursive: true });
  const sqlite = openDatabase(join(dir, "app.db"));
  migrate(sqlite, [workspaceMigrations, agentMigrations, { domain: "memory", dir: before }]);
  const db = drizzle({ client: sqlite });
  const now = new Date("2026-10-01T00:00:00Z");
  const owner = { kind: "owner", loginId: "login_a" } as const;
  const workspaceScope = resolveWorkspaceScope(db, createWorkspace(db, { name: "A", now }).id, owner)!;
  const bot = createBot(db, workspaceScope, {
    name: "Bot",
    instructions: "手伝う",
    model: "sonnet",
    tools: ["memory"],
    now,
  });
  sqlite.run(
    "INSERT INTO memory_items (id, workspace_id, bot_id, type, title, description, tags, body, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, 'note', '旅程', '', '[]', '京都の宿', 'bot', 'bot', 0, 0)",
    [`memory_${Bun.randomUUIDv7()}`, workspaceScope.workspaceId, bot.id],
  );

  migrate(sqlite, [workspaceMigrations, agentMigrations, migrations]);

  expect(searchMemoryItems(db, workspaceScope, bot.id, "京都の").map((i) => i.body)).toEqual(["京都の宿"]);
  sqlite.close();
});
