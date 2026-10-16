import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createBot, getBot, listBots, updateBot } from "./bots.ts";
import { migrations } from "./index.ts";
import { InvalidCursor } from "./paging.ts";
import { resolveWorkspaceScope, type WorkspaceScope } from "./workspace-scope.ts";
import { workspaceOwnedTableProblems } from "./testing.ts";
import { createWorkspace } from "./workspaces.ts";

const now = new Date("2026-10-01T00:00:00Z");
const owner = { kind: "owner", loginId: "login_test" } as const;
const settings = {
  name: "仕事 Bot",
  instructions: "議事録を手伝う",
  model: "sonnet",
  tools: ["memory"],
} as const;

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });
let a: WorkspaceScope;
let b: WorkspaceScope;

beforeEach(() => {
  testDb = migratedTestDatabase([migrations]);
  a = resolveWorkspaceScope(db(), createWorkspace(db(), { name: "A", now }).id, owner)!;
  b = resolveWorkspaceScope(db(), createWorkspace(db(), { name: "B", now }).id, owner)!;
});

afterEach(() => {
  testDb.close();
});

describe("Bots", () => {
  test("a created Bot keeps its settings, including model and tools, after reopening the database", () => {
    const bot = createBot(db(), a, { ...settings, tools: [...settings.tools], now });
    expect(bot.id).toMatch(/^bot_[0-9a-f-]{36}$/);

    testDb.reopen();
    expect(getBot(db(), a, bot.id)).toEqual({
      id: bot.id,
      workspaceId: a.workspaceId,
      name: "仕事 Bot",
      instructions: "議事録を手伝う",
      instructionsVersion: 1,
      model: "sonnet",
      tools: ["memory"],
      createdAt: now,
    });
  });

  test("a Bot is listed newest first, only in its own Workspace", () => {
    const first = createBot(db(), a, { ...settings, name: "1", tools: [], now });
    const second = createBot(db(), a, { ...settings, name: "2", tools: [], now });
    createBot(db(), b, { ...settings, name: "B の Bot", tools: [], now });

    expect(listBots(db(), a, {}).items.map((bot) => bot.id)).toEqual([second.id, first.id]);
    expect(listBots(db(), b, {}).items.map((bot) => bot.name)).toEqual(["B の Bot"]);
  });

  test("another Workspace's WorkspaceScope neither reads nor updates a Bot", () => {
    const bot = createBot(db(), a, { ...settings, tools: [], now });

    expect(getBot(db(), b, bot.id)).toBeUndefined();
    expect(updateBot(db(), b, bot.id, { name: "乗っ取り", model: "opus" })).toBeUndefined();
    expect(getBot(db(), a, bot.id)).toMatchObject({ name: "仕事 Bot", model: "sonnet" });
  });

  test("an update changes only the given settings", () => {
    const bot = createBot(db(), a, { ...settings, tools: ["memory"], now });

    expect(updateBot(db(), a, bot.id, { model: "haiku", tools: [] })).toMatchObject({
      name: "仕事 Bot",
      instructions: "議事録を手伝う",
      model: "haiku",
      tools: [],
    });
  });

  test("a Bot list cursor is accepted only by the same Workspace's Bot list", () => {
    createBot(db(), a, { ...settings, name: "1", tools: [], now });
    createBot(db(), a, { ...settings, name: "2", tools: [], now });
    createBot(db(), a, { ...settings, name: "3", tools: [], now });

    const page1 = listBots(db(), a, { limit: 2 });
    expect(page1.items.map((bot) => bot.name)).toEqual(["3", "2"]);
    const page2 = listBots(db(), a, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((bot) => bot.name)).toEqual(["1"]);
    expect(page2.nextCursor).toBeUndefined();

    expect(() => listBots(db(), b, { cursor: page1.nextCursor })).toThrow(InvalidCursor);
    expect(() => listBots(db(), a, { cursor: "garbage" })).toThrow(InvalidCursor);
  });
});

describe("Bot rows in the database", () => {
  test("the bots table follows every Workspace-owned table rule", () => {
    expect(workspaceOwnedTableProblems(testDb.sqlite)).toEqual([]);
  });

  test("a Bot cannot be moved to another Workspace, even bypassing the domain functions", () => {
    const bot = createBot(db(), a, { ...settings, tools: [], now });

    expect(() =>
      testDb.sqlite.run("UPDATE bots SET workspace_id = ? WHERE id = ?", [b.workspaceId, bot.id]),
    ).toThrow(/workspace_id is immutable/);
    expect(getBot(db(), a, bot.id)).toBeDefined();
  });

  test("a Bot cannot be created under a Workspace that does not exist", () => {
    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO bots (id, workspace_id, name, instructions, model, tools, created_at) VALUES ('bot_x', 'workspace_missing', 'x', 'x', 'sonnet', '[]', 0)",
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("a child that names another Workspace's Bot is refused by the (workspace_id, bot_id) key", () => {
    const botOfB = createBot(db(), b, { ...settings, tools: [], now });
    testDb.sqlite.run(
      "CREATE TABLE probe (workspace_id text NOT NULL, bot_id text NOT NULL, FOREIGN KEY (workspace_id, bot_id) REFERENCES bots (workspace_id, id))",
    );

    expect(() => testDb.sqlite.run("INSERT INTO probe VALUES (?, ?)", [a.workspaceId, botOfB.id])).toThrow(
      /FOREIGN KEY constraint failed/,
    );
    testDb.sqlite.run("INSERT INTO probe VALUES (?, ?)", [b.workspaceId, botOfB.id]);
  });
});
