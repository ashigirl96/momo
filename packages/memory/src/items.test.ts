import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrations as agentMigrations, postOwnerMessage, startNextRun, type Run } from "@momo/agent";
import type { MemoryItemDraft } from "@momo/contracts";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import {
  createBot,
  createConversation,
  createWorkspace,
  InvalidCursor,
  migrations as workspaceMigrations,
  resolveTenant,
  type Bot,
  type TenantContext,
} from "@momo/workspace";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, readFileSync } from "node:fs";
import {
  deleteMemoryItem,
  detachMemoryFromConversation,
  getMemoryItem,
  listMemoryItems,
  searchMemoryItems,
  writeMemoryItem,
} from "./items.ts";
import { migrations } from "./index.ts";

const now = new Date("2026-10-01T00:00:00Z");
const settings = { instructions: "手伝う", model: "sonnet" as const, tools: ["memory" as const] };

const rawInsert = (tenant: TenantContext, botId: string, runId: string | null) =>
  testDb.sqlite.run(
    "INSERT INTO memory_items (id, workspace_id, bot_id, type, title, description, tags, body, created_by, created_run_id, updated_by, created_at, updated_at) VALUES (?, ?, ?, 'note', 't', '', '[]', 'b', 'bot', ?, 'bot', 0, 0)",
    [`memory_${Bun.randomUUIDv7()}`, tenant.workspaceId, botId, runId],
  );

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });

type Fixture = { tenant: TenantContext; bot: Bot; other: Bot; run: Run; conversationId: string };
let a: Fixture;
let b: Fixture;

function tenantNamed(name: string): TenantContext {
  return resolveTenant(db(), createWorkspace(db(), { name, now }).id, {
    kind: "owner",
    loginId: `login_${name}`,
  })!;
}

/** Starts a Run of `bot` in a new Conversation, as a memory tool request would arrive inside it. */
function runningRun(tenant: TenantContext, bot: Bot): Run {
  const conversation = createConversation(db(), tenant, { primaryBotId: bot.id, now })!;
  const { run } = postOwnerMessage(db(), tenant, { conversationId: conversation.id, text: "覚えて", now })!;
  return startNextRun(db(), tenant, run.sessionId, now)!.run;
}

function fixture(name: string): Fixture {
  const tenant = tenantNamed(name);
  const bot = createBot(db(), tenant, { ...settings, name: `${name} の Bot`, now });
  const other = createBot(db(), tenant, { ...settings, name: `${name} の別の Bot`, now });
  const run = runningRun(tenant, bot);
  return { tenant, bot, other, run, conversationId: run.conversationId };
}

const draft = (body: string, extra: Partial<MemoryItemDraft> = {}): MemoryItemDraft => ({
  type: "note",
  title: body.slice(0, 20),
  description: "",
  tags: [],
  body,
  ...extra,
});

const write = (f: Fixture, body: string, extra?: Partial<MemoryItemDraft>, run = f.run) =>
  writeMemoryItem(db(), f.tenant, { runId: run.id, item: draft(body, extra), now });

const titles = (f: Fixture, query: string, bot = f.bot) =>
  searchMemoryItems(db(), f.tenant, bot.id, query).map((item) => item.body);

beforeEach(() => {
  testDb = migratedTestDatabase([workspaceMigrations, agentMigrations, migrations]);
  a = fixture("A");
  b = fixture("B");
});

afterEach(() => {
  testDb.close();
});

describe("writing a Memory item", () => {
  test("stores the Bot's fields and the Run and writer the backend recorded", () => {
    const item = write(a, "朝はコーヒーを飲む", {
      type: "preference",
      title: "朝の飲み物",
      description: "所有者の好み",
      tags: ["朝", "飲み物"],
      resource: "https://example.com/note",
    })!;

    expect(item).toMatchObject({
      workspaceId: a.tenant.workspaceId,
      botId: a.bot.id,
      type: "preference",
      title: "朝の飲み物",
      description: "所有者の好み",
      tags: ["朝", "飲み物"],
      resource: "https://example.com/note",
      body: "朝はコーヒーを飲む",
      createdBy: "bot",
      createdRunId: a.run.id,
      updatedBy: "bot",
      updatedRunId: a.run.id,
    });
    expect(item.id).toMatch(/^memory_[0-9a-f-]{36}$/);
    expect(getMemoryItem(db(), a.tenant, a.bot.id, item.id)?.created).toEqual({
      writer: "bot",
      source: { kind: "conversation", conversationId: a.conversationId, runId: a.run.id },
    });
  });

  test("is refused, writing nothing, for a Run that is not running in the tenant", () => {
    expect(
      writeMemoryItem(db(), b.tenant, { runId: a.run.id, item: draft("越境の記憶"), now }),
    ).toBeUndefined();
    expect(
      writeMemoryItem(db(), a.tenant, { runId: "run_missing", item: draft("無い Run"), now }),
    ).toBeUndefined();

    const queued = postOwnerMessage(db(), a.tenant, {
      conversationId: a.conversationId,
      text: "次",
      now,
    })!.run;
    expect(write(a, "待っている Run の記憶", {}, queued)).toBeUndefined();

    expect(listMemoryItems(db(), a.tenant, a.bot.id, {}).items).toEqual([]);
    expect(listMemoryItems(db(), b.tenant, b.bot.id, {}).items).toEqual([]);
    expect(titles(a, "記憶")).toEqual([]);
  });

  test("leaves neither the item nor its index entry when indexing fails", () => {
    testDb.sqlite.run("DROP TRIGGER memory_items_fts_insert");
    testDb.sqlite.run(
      "CREATE TRIGGER memory_items_fts_insert AFTER INSERT ON memory_items BEGIN SELECT RAISE(ABORT, 'index down'); END",
    );

    expect(() => write(a, "書けない記憶")).toThrow();
    expect(listMemoryItems(db(), a.tenant, a.bot.id, {}).items).toEqual([]);
    expect(testDb.sqlite.query("SELECT count(*) AS n FROM memory_fts").get()).toEqual({ n: 0 });
  });

  test("cannot point at another Workspace's Bot or Run, even in raw SQL", () => {
    expect(() => rawInsert(a.tenant, b.bot.id, null)).toThrow("FOREIGN KEY constraint failed");
    expect(() => rawInsert(a.tenant, a.bot.id, b.run.id)).toThrow("FOREIGN KEY constraint failed");
    expect(() => rawInsert(a.tenant, a.bot.id, a.run.id)).not.toThrow();
  });

  test("cannot be moved to another Workspace", () => {
    const item = write(a, "動かない記憶")!;

    expect(() =>
      testDb.sqlite.run("UPDATE memory_items SET workspace_id = ? WHERE id = ?", [
        b.tenant.workspaceId,
        item.id,
      ]),
    ).toThrow("workspace_id is immutable");
  });
});

describe("searching Memory items", () => {
  test("finds a Bot's item from another of its Conversations by a Japanese substring", () => {
    write(a, "所有者は毎朝コーヒーを二杯飲む");
    const later = runningRun(a.tenant, a.bot);

    expect(later.conversationId).not.toBe(a.conversationId);
    expect(titles(a, "コーヒー")).toEqual(["所有者は毎朝コーヒーを二杯飲む"]);
    expect(titles(a, "紅茶")).toEqual([]);
  });

  test("matches title, description and tags as well as the body", () => {
    write(a, "本文だけ", { title: "旅行の計画", description: "夏休みの行き先", tags: ["沖縄旅行"] });

    expect(titles(a, "旅行の")).toEqual(["本文だけ"]);
    expect(titles(a, "夏休み")).toEqual(["本文だけ"]);
    expect(titles(a, "沖縄")).toEqual(["本文だけ"]);
  });

  test("fills in terms shorter than three characters with LIKE, and needs every term", () => {
    write(a, "猫の名前はタマ");
    write(a, "犬の名前はポチ");

    expect(titles(a, "猫")).toEqual(["猫の名前はタマ"]);
    expect(titles(a, "名前 タマ")).toEqual(["猫の名前はタマ"]);
    expect(titles(a, "名前は 犬")).toEqual(["犬の名前はポチ"]);
    expect(titles(a, "名前は 鳥")).toEqual([]);
  });

  test("treats FTS and LIKE syntax in the query as plain text", () => {
    write(a, "100% の確率で晴れ");
    write(a, "雨 OR 雪");

    expect(titles(a, '"')).toEqual([]);
    expect(titles(a, "%")).toEqual(["100% の確率で晴れ"]);
    expect(titles(a, "_")).toEqual([]);
    expect(titles(a, "OR 雪")).toEqual(["雨 OR 雪"]);
    expect(titles(a, 'NEAR("雨" "雪")')).toEqual([]);
  });

  test("never returns another Bot's or another Workspace's item, even for the same words", () => {
    write(a, "共通の合言葉はさくら");
    write(b, "共通の合言葉はさくら B");
    writeMemoryItem(db(), a.tenant, {
      runId: runningRun(a.tenant, a.other).id,
      item: draft("共通の合言葉はさくら 別の Bot"),
      now,
    });

    expect(titles(a, "合言葉")).toEqual(["共通の合言葉はさくら"]);
    expect(titles(a, "合")).toEqual(["共通の合言葉はさくら"]);
    expect(titles(a, "合言葉", a.other)).toEqual(["共通の合言葉はさくら 別の Bot"]);
    expect(titles(b, "合言葉")).toEqual(["共通の合言葉はさくら B"]);
    expect(searchMemoryItems(db(), a.tenant, b.bot.id, "合言葉")).toEqual([]);
    expect(searchMemoryItems(db(), b.tenant, a.bot.id, "合言葉")).toEqual([]);
  });
});

describe("listing, reading and deleting Memory items", () => {
  test("lists a Bot's items newest first, a page at a time", () => {
    const first = write(a, "一つ目")!;
    const second = write(a, "二つ目")!;
    write(b, "B の記憶");

    const page = listMemoryItems(db(), a.tenant, a.bot.id, { limit: 1 });
    expect(page.items.map((i) => i.id)).toEqual([second.id]);
    const next = listMemoryItems(db(), a.tenant, a.bot.id, { limit: 1, cursor: page.nextCursor });
    expect(next.items.map((i) => i.id)).toEqual([first.id]);
    expect(next.nextCursor).toBeUndefined();
    expect(listMemoryItems(db(), a.tenant, a.other.id, {}).items).toEqual([]);
  });

  test("a cursor of another Workspace or list is refused", () => {
    write(a, "一つ目");
    write(a, "二つ目");
    const cursor = listMemoryItems(db(), a.tenant, a.bot.id, { limit: 1 }).nextCursor!;

    expect(() => listMemoryItems(db(), b.tenant, b.bot.id, { cursor })).toThrow(InvalidCursor);
  });

  test("another Bot's or Workspace's item id reads and deletes nothing", () => {
    const item = write(a, "守る記憶")!;

    expect(getMemoryItem(db(), a.tenant, a.other.id, item.id)).toBeUndefined();
    expect(getMemoryItem(db(), b.tenant, b.bot.id, item.id)).toBeUndefined();
    expect(getMemoryItem(db(), b.tenant, a.bot.id, item.id)).toBeUndefined();
    expect(deleteMemoryItem(db(), a.tenant, a.other.id, item.id)).toBe(false);
    expect(deleteMemoryItem(db(), b.tenant, a.bot.id, item.id)).toBe(false);
    expect(getMemoryItem(db(), a.tenant, a.bot.id, item.id)?.body).toBe("守る記憶");
    expect(titles(a, "守る記憶")).toEqual(["守る記憶"]);
  });

  test("deleting removes the item and its index entry at once", () => {
    const item = write(a, "忘れてほしい秘密の合言葉")!;
    write(a, "残す合言葉");

    expect(deleteMemoryItem(db(), a.tenant, a.bot.id, item.id)).toBe(true);
    expect(getMemoryItem(db(), a.tenant, a.bot.id, item.id)).toBeUndefined();
    expect(titles(a, "合言葉")).toEqual(["残す合言葉"]);
    expect(titles(a, "秘密")).toEqual([]);
    expect(
      testDb.sqlite.query("SELECT count(*) AS n FROM memory_fts WHERE item_id = ?").get(item.id),
    ).toEqual({ n: 0 });
  });

  test("a deleted item leaves no plaintext in the database files", () => {
    const secret = "ZQXJ-消えるべき記憶-7731";
    const item = write(a, secret, { title: `${secret} の題`, tags: [secret] })!;
    testDb.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
    expect(scan(secret)).toBeGreaterThan(0);

    expect(scan("zqx")).toBeGreaterThan(0);

    deleteMemoryItem(db(), a.tenant, a.bot.id, item.id);
    testDb.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");

    expect(scan(secret)).toBe(0);
    expect(scan("zqx")).toBe(0);
  });
});

describe("deleting the source Conversation", () => {
  test("empties the Run references of the items it wrote and shows them as from a deleted Conversation", () => {
    const fromA = write(a, "消える会話で覚えた")!;
    const later = runningRun(a.tenant, a.bot);
    const kept = writeMemoryItem(db(), a.tenant, { runId: later.id, item: draft("残る会話で覚えた"), now })!;
    const inB = write(b, "B の会話で覚えた")!;

    expect(detachMemoryFromConversation(db(), a.tenant, a.conversationId)).toBe(1);

    const detached = getMemoryItem(db(), a.tenant, a.bot.id, fromA.id)!;
    expect(detached).toMatchObject({ createdRunId: null, updatedRunId: null, body: "消える会話で覚えた" });
    expect(detached.created).toEqual({ writer: "bot", source: { kind: "deleted_conversation" } });
    expect(detached.updated).toEqual({ writer: "bot", source: { kind: "deleted_conversation" } });
    expect(getMemoryItem(db(), a.tenant, a.bot.id, kept.id)?.created).toEqual({
      writer: "bot",
      source: { kind: "conversation", conversationId: later.conversationId, runId: later.id },
    });
    expect(titles(a, "消える会話")).toEqual(["消える会話で覚えた"]);
    expect(getMemoryItem(db(), b.tenant, b.bot.id, inB.id)?.createdRunId).toBe(b.run.id);
  });

  test("touches nothing for another Workspace's Conversation id", () => {
    const item = write(a, "守る出典")!;

    expect(detachMemoryFromConversation(db(), b.tenant, a.conversationId)).toBe(0);
    expect(getMemoryItem(db(), a.tenant, a.bot.id, item.id)?.createdRunId).toBe(a.run.id);
  });
});

function scan(needle: string): number {
  const bytes = Buffer.from(needle);
  let hits = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${testDb.path}${suffix}`;
    if (!existsSync(path)) continue;
    const data = readFileSync(path);
    for (let at = data.indexOf(bytes); at >= 0; at = data.indexOf(bytes, at + 1)) hits++;
  }
  return hits;
}
