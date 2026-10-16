import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createBot } from "./bots.ts";
import { createConversation, getConversation, listConversations } from "./conversations.ts";
import { migrations } from "./index.ts";
import { InvalidCursor } from "./paging.ts";
import { resolveTenant, type TenantContext } from "./tenant.ts";
import { workspaceOwnedTableProblems } from "./testing.ts";
import { createWorkspace } from "./workspaces.ts";

const now = new Date("2026-10-01T00:00:00Z");
const owner = { kind: "owner", loginId: "login_test" } as const;
const settings = { name: "仕事 Bot", instructions: "議事録を手伝う", model: "sonnet", tools: [] } as const;

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });
let a: TenantContext;
let b: TenantContext;

beforeEach(() => {
  testDb = migratedTestDatabase([migrations]);
  a = resolveTenant(db(), createWorkspace(db(), { name: "A", now }).id, owner)!;
  b = resolveTenant(db(), createWorkspace(db(), { name: "B", now }).id, owner)!;
});

afterEach(() => {
  testDb.close();
});

const bot = (tenant: TenantContext, name = "仕事 Bot") =>
  createBot(db(), tenant, { ...settings, name, tools: [], now });

describe("Conversations", () => {
  test("a Conversation has its Bot as the one primary participant, after reopening the database", () => {
    const work = bot(a);
    const conversation = createConversation(db(), a, { primaryBotId: work.id, now })!;
    expect(conversation.id).toMatch(/^conversation_[0-9a-f-]{36}$/);

    testDb.reopen();
    expect(getConversation(db(), a, conversation.id)).toEqual({
      id: conversation.id,
      workspaceId: a.workspaceId,
      primaryBotId: work.id,
      participants: [{ botId: work.id, role: "primary" }],
      createdAt: now,
    });
  });

  test("a Bot of another Workspace cannot be the primary Bot", () => {
    const botOfB = bot(b);

    expect(createConversation(db(), a, { primaryBotId: botOfB.id, now })).toBeUndefined();
    expect(listConversations(db(), a, {}).items).toEqual([]);
    expect(listConversations(db(), b, {}).items).toEqual([]);
  });

  test("another Workspace's TenantContext cannot read a Conversation", () => {
    const conversation = createConversation(db(), a, { primaryBotId: bot(a).id, now })!;

    expect(getConversation(db(), b, conversation.id)).toBeUndefined();
  });

  test("Conversations are listed newest first, only in their own Workspace, and filter by Bot", () => {
    const work = bot(a, "仕事 Bot");
    const travel = bot(a, "旅行 Bot");
    const first = createConversation(db(), a, { primaryBotId: work.id, now })!;
    const second = createConversation(db(), a, { primaryBotId: travel.id, now })!;
    const third = createConversation(db(), a, { primaryBotId: work.id, now })!;
    createConversation(db(), b, { primaryBotId: bot(b).id, now });

    expect(listConversations(db(), a, {}).items.map((c) => c.id)).toEqual([third.id, second.id, first.id]);
    expect(listConversations(db(), a, {}).items[0]).toEqual({
      id: third.id,
      workspaceId: a.workspaceId,
      primaryBotId: work.id,
      createdAt: now,
    });
    expect(listConversations(db(), b, {}).items).toHaveLength(1);
  });

  test("a Conversation list cursor is accepted only by the same Workspace's Conversation list", () => {
    const work = bot(a);
    for (let i = 0; i < 3; i++) createConversation(db(), a, { primaryBotId: work.id, now });

    const page1 = listConversations(db(), a, { limit: 2 });
    const page2 = listConversations(db(), a, { limit: 2, cursor: page1.nextCursor });
    expect([...page1.items, ...page2.items]).toHaveLength(3);
    expect(page2.nextCursor).toBeUndefined();

    expect(() => listConversations(db(), b, { cursor: page1.nextCursor })).toThrow(InvalidCursor);
  });
});

describe("Conversation rows in the database", () => {
  test("the conversation tables follow every Workspace-owned table rule", () => {
    expect(workspaceOwnedTableProblems(testDb.sqlite)).toEqual([]);
  });

  test("a participant must be a Bot of the Conversation's Workspace, even bypassing the domain functions", () => {
    const conversation = createConversation(db(), a, { primaryBotId: bot(a).id, now })!;
    const botOfB = bot(b);

    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO conversation_participants (id, workspace_id, conversation_id, bot_id, role, joined_at) VALUES ('participant_x', ?, ?, ?, 'member', 0)",
        [a.workspaceId, conversation.id, botOfB.id],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO conversation_participants (id, workspace_id, conversation_id, bot_id, role, joined_at) VALUES ('participant_y', ?, ?, ?, 'member', 0)",
        [b.workspaceId, conversation.id, botOfB.id],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("a Conversation has at most one primary Bot", () => {
    const conversation = createConversation(db(), a, { primaryBotId: bot(a).id, now })!;
    const second = bot(a, "旅行 Bot");

    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO conversation_participants (id, workspace_id, conversation_id, bot_id, role, joined_at) VALUES ('participant_z', ?, ?, ?, 'primary', 0)",
        [a.workspaceId, conversation.id, second.id],
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  test("a Conversation cannot be moved to another Workspace", () => {
    const conversation = createConversation(db(), a, { primaryBotId: bot(a).id, now })!;

    expect(() =>
      testDb.sqlite.run("UPDATE conversations SET workspace_id = ? WHERE id = ?", [
        b.workspaceId,
        conversation.id,
      ]),
    ).toThrow(/workspace_id is immutable/);
  });
});
