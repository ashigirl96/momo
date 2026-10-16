import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  AttachmentFiles,
  appendRunDelta,
  finishRun,
  postOwnerMessage,
  resetSession,
  startNextRun,
} from "@momo/agent";
import { getMemoryItem, searchMemoryItems, writeMemoryItem } from "@momo/memory";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import {
  createBot,
  createConversation,
  createWorkspace,
  findWorkspace,
  getBot,
  getConversation,
  resolveWorkspaceScope,
  type WorkspaceScope,
} from "@momo/workspace";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteBotEverywhere,
  deleteWorkspaceEverywhere,
  previewBotDeletion,
  previewWorkspaceDeletion,
} from "./deletion.ts";
import { appDbDomains } from "./domains.ts";

const now = new Date("2026-10-01T00:00:00Z");
const settings = { instructions: "手伝う", model: "sonnet" as const, tools: ["memory" as const] };

let testDb: TestDatabase;
let dataDir: string;
let files: AttachmentFiles;
const db = () => drizzle({ client: testDb.sqlite });

beforeEach(() => {
  testDb = migratedTestDatabase(appDbDomains);
  dataDir = mkdtempSync(join(tmpdir(), "momo-deletion-"));
  files = new AttachmentFiles(join(dataDir, "attachments"));
});

afterEach(() => {
  testDb.close();
  rmSync(dataDir, { recursive: true, force: true });
});

type Seeded = {
  scope: WorkspaceScope;
  botId: string;
  otherBotId: string;
  conversations: string[];
  otherConversation: string;
  memoryId: string;
  otherMemoryId: string;
  attachmentId: string;
  runningRunId: string;
};

/** `secret` is in every text the owner or the Bot wrote. */
function seed(name: string, secret: string): Seeded {
  const scope = resolveWorkspaceScope(db(), createWorkspace(db(), { name, now }).id, {
    kind: "owner",
    loginId: "login_test",
  })!;
  const bot = createBot(db(), scope, { ...settings, name: `${secret} Bot`, now });
  const other = createBot(db(), scope, { ...settings, name: `${name} 残る Bot`, now });
  const first = createConversation(db(), scope, { primaryBotId: bot.id, now })!.id;
  const second = createConversation(db(), scope, { primaryBotId: bot.id, now })!.id;
  const otherConversation = createConversation(db(), scope, { primaryBotId: other.id, now })!.id;

  const posted = postOwnerMessage(db(), scope, {
    conversationId: first,
    text: `${secret} を覚えて`,
    now,
    attachments: {
      files,
      newAttachments: [
        { name: `${secret}.txt`, contentType: "text/plain", bytes: new TextEncoder().encode(secret) },
      ],
    },
  })!;
  startNextRun(db(), scope, posted.run.sessionId, now);
  appendRunDelta(db(), scope, posted.run.id, `覚えました: ${secret}`, now);
  const memory = writeMemoryItem(db(), scope, {
    runId: posted.run.id,
    item: {
      type: "note",
      title: `${secret} の題`,
      description: secret,
      tags: [secret],
      body: `${secret} の本文`,
    },
    now,
  })!;
  finishRun(db(), scope, posted.run.id, { outcome: "completed", now });
  resetSession(db(), scope, { conversationId: first, now });

  const running = postOwnerMessage(db(), scope, { conversationId: second, text: `${secret} 実行中`, now })!;
  startNextRun(db(), scope, running.run.sessionId, now);
  appendRunDelta(db(), scope, running.run.id, `${secret} 途中`, now);
  postOwnerMessage(db(), scope, { conversationId: second, text: `${secret} 待ち`, now });

  const kept = postOwnerMessage(db(), scope, { conversationId: otherConversation, text: "残る話", now })!;
  startNextRun(db(), scope, kept.run.sessionId, now);
  const otherMemory = writeMemoryItem(db(), scope, {
    runId: kept.run.id,
    item: { type: "note", title: "残る記憶", description: "", tags: [], body: "残る記憶の本文" },
    now,
  })!;
  finishRun(db(), scope, kept.run.id, { outcome: "completed", now });

  return {
    scope,
    botId: bot.id,
    otherBotId: other.id,
    conversations: [first, second],
    otherConversation,
    memoryId: memory.id,
    otherMemoryId: otherMemory.id,
    attachmentId: posted.message.attachments[0]!.id,
    runningRunId: running.run.id,
  };
}

function rowsOf(workspaceId: string): Record<string, number> {
  const tables = testDb.sqlite
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((t) => t.name)
    .filter((name) =>
      testDb.sqlite
        .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('${name}')`)
        .all()
        .some((c) => c.name === "workspace_id"),
    );
  const counts: Record<string, number> = {
    workspaces: testDb.sqlite
      .query<{ n: number }, [string]>("SELECT count(*) AS n FROM workspaces WHERE id = ?")
      .get(workspaceId)!.n,
  };
  for (const table of tables)
    counts[table] = testDb.sqlite
      .query<{ n: number }, [string]>(`SELECT count(*) AS n FROM "${table}" WHERE workspace_id = ?`)
      .get(workspaceId)!.n;
  return counts;
}

function nonEmpty(counts: Record<string, number>): string[] {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([table]) => table)
    .toSorted();
}

function scan(needle: string): number {
  const bytes = Buffer.from(needle);
  let hits = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    const path = `${testDb.path}${suffix}`;
    if (!existsSync(path)) continue;
    const content = readFileSync(path);
    for (let at = content.indexOf(bytes); at !== -1; at = content.indexOf(bytes, at + 1)) hits++;
  }
  return hits;
}

function attachmentFiles(scope: WorkspaceScope): string[] {
  const dir = join(dataDir, "attachments", scope.workspaceId);
  return existsSync(dir) ? readdirSync(dir) : [];
}

const EVERY_TABLE = [
  "attachments",
  "bots",
  "conversation_events",
  "conversation_participants",
  "conversations",
  "memory_fts",
  "memory_items",
  "messages",
  "runs",
  "sessions",
  "workspaces",
];

describe("deleting a Workspace", () => {
  test("deletes every row of the Workspace in every domain and its Attachment files", () => {
    const a = seed("個人", "QWX-個人の秘密-1");
    const b = seed("会社", "JKV-会社の秘密-2");
    expect(nonEmpty(rowsOf(a.scope.workspaceId))).toEqual(EVERY_TABLE);

    const deleted = deleteWorkspaceEverywhere(db(), files, a.scope);

    expect(deleted.conversationIds.toSorted()).toEqual([...a.conversations, a.otherConversation].toSorted());
    expect(deleted.runningRunIds).toEqual([a.runningRunId]);
    expect(nonEmpty(rowsOf(a.scope.workspaceId))).toEqual([]);
    expect(findWorkspace(db(), a.scope.workspaceId)).toBeUndefined();
    expect(existsSync(join(dataDir, "attachments", a.scope.workspaceId))).toBe(false);

    expect(nonEmpty(rowsOf(b.scope.workspaceId))).toEqual(EVERY_TABLE);
    expect(attachmentFiles(b.scope)).toEqual([b.attachmentId]);
    expect(searchMemoryItems(db(), b.scope, b.botId, "JKV").map((m) => m.id)).toEqual([b.memoryId]);
  });

  test("leaves none of the deleted text in app.db, its WAL or the full-text index", () => {
    const secret = "QWX-消えるべき秘密-7731";
    const a = seed("個人", secret);
    seed("会社", "JKV-残る秘密-8842");
    testDb.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");
    expect(scan(secret)).toBeGreaterThan(0);
    // The trigram index stores three-character tokens of the text, lower-cased.
    expect(scan("qwx")).toBeGreaterThan(0);

    deleteWorkspaceEverywhere(db(), files, a.scope);
    testDb.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");

    expect(scan(secret)).toBe(0);
    expect(scan("QWX")).toBe(0);
    expect(scan("qwx")).toBe(0);
    expect(scan(a.scope.workspaceId)).toBe(0);
    expect(scan("JKV-残る秘密-8842")).toBeGreaterThan(0);
    expect(scan("jkv")).toBeGreaterThan(0);
  });

  test("deletes nothing, files included, when one step fails", () => {
    const a = seed("個人", "QWX-1");
    const before = rowsOf(a.scope.workspaceId);
    testDb.sqlite.run(
      "CREATE TRIGGER fail_workspace_delete BEFORE DELETE ON workspaces BEGIN SELECT RAISE(ABORT, 'injected'); END",
    );

    expect(() => deleteWorkspaceEverywhere(db(), files, a.scope)).toThrow(/delete from "workspaces"/);

    expect(rowsOf(a.scope.workspaceId)).toEqual(before);
    expect(attachmentFiles(a.scope)).toEqual([a.attachmentId]);
    expect(getMemoryItem(db(), a.scope, a.botId, a.memoryId)?.createdRunId).not.toBeNull();
    expect(searchMemoryItems(db(), a.scope, a.botId, "QWX").map((m) => m.id)).toEqual([a.memoryId]);
  });

  test("the preview counts the Conversations that will go", () => {
    const a = seed("個人", "QWX-1");
    seed("会社", "JKV-2");

    expect(previewWorkspaceDeletion(db(), a.scope)).toEqual({ conversations: 3 });
  });
});

describe("deleting a Bot", () => {
  test("deletes its Memory items and the Conversations it leads with their messages, Runs and Attachments", () => {
    const a = seed("個人", "QWX-個人-1");
    const b = seed("会社", "JKV-会社-2");
    const others = rowsOf(b.scope.workspaceId);

    const deleted = deleteBotEverywhere(db(), files, a.scope, a.botId)!;

    expect(deleted.conversationIds.toSorted()).toEqual(a.conversations.toSorted());
    expect(deleted.runningRunIds).toEqual([a.runningRunId]);
    expect(getBot(db(), a.scope, a.botId)).toBeUndefined();
    for (const id of a.conversations) expect(getConversation(db(), a.scope, id)).toBeUndefined();
    expect(getMemoryItem(db(), a.scope, a.botId, a.memoryId)).toBeUndefined();
    expect(attachmentFiles(a.scope)).toEqual([]);

    expect(getBot(db(), a.scope, a.otherBotId)).toBeDefined();
    expect(getConversation(db(), a.scope, a.otherConversation)).toBeDefined();
    expect(getMemoryItem(db(), a.scope, a.otherBotId, a.otherMemoryId)?.createdRunId).not.toBeNull();
    const left = rowsOf(a.scope.workspaceId);
    expect(left).toMatchObject({
      workspaces: 1,
      bots: 1,
      conversations: 1,
      memory_items: 1,
      memory_fts: 1,
      attachments: 0,
    });
    expect(rowsOf(b.scope.workspaceId)).toEqual(others);
  });

  test("leaves none of its text in app.db or the full-text index", () => {
    const secret = "QWX-消える Bot の秘密-5512";
    const a = seed("個人", secret);
    deleteBotEverywhere(db(), files, a.scope, a.botId);
    testDb.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");

    expect(scan(secret)).toBe(0);
    expect(scan("qwx")).toBe(0);
    expect(scan("残る記憶の本文")).toBeGreaterThan(0);
  });

  test("deletes nothing when one step fails", () => {
    const a = seed("個人", "QWX-1");
    const before = rowsOf(a.scope.workspaceId);
    testDb.sqlite.run(
      "CREATE TRIGGER fail_bot_delete BEFORE DELETE ON bots BEGIN SELECT RAISE(ABORT, 'injected'); END",
    );

    expect(() => deleteBotEverywhere(db(), files, a.scope, a.botId)).toThrow(/delete from "bots"/);

    expect(rowsOf(a.scope.workspaceId)).toEqual(before);
    expect(attachmentFiles(a.scope)).toEqual([a.attachmentId]);
  });

  test("another Workspace's Bot id deletes nothing", () => {
    const a = seed("個人", "QWX-1");
    const b = seed("会社", "JKV-2");
    const before = { a: rowsOf(a.scope.workspaceId), b: rowsOf(b.scope.workspaceId) };

    expect(deleteBotEverywhere(db(), files, a.scope, b.botId)).toBeUndefined();
    expect(previewBotDeletion(db(), a.scope, b.botId)).toBeUndefined();

    expect({ a: rowsOf(a.scope.workspaceId), b: rowsOf(b.scope.workspaceId) }).toEqual(before);
    expect(attachmentFiles(b.scope)).toEqual([b.attachmentId]);
  });

  test("the preview counts the Conversations it leads", () => {
    const a = seed("個人", "QWX-1");

    expect(previewBotDeletion(db(), a.scope, a.botId)).toEqual({ conversations: 2 });
    expect(previewBotDeletion(db(), a.scope, a.otherBotId)).toEqual({ conversations: 1 });
  });
});
