import { afterEach, expect, test } from "bun:test";
import { BotItem, ConversationList, MemoryList, MessagePage, WorkspaceList } from "@momo/contracts";
import { migrate, openDatabase, type MigrationSource } from "@momo/migrator";
import { workspaceOwnedTableProblems } from "@momo/workspace/testing";
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDbDomains } from "./domains.ts";
import { Api, finished, frames } from "./gate-fixture.ts";
import { startTestBackend } from "./testing.ts";

const dirs: string[] = [];
let api: Api | undefined;

afterEach(async () => {
  await api?.b.cleanup();
  api = undefined;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** The migrations of the previous version: every domain without its latest migration. */
function previousVersion(sources: MigrationSource[]): MigrationSource[] {
  const root = tempDir("momo-previous-");
  return sources.map(({ domain, dir }) => {
    const copy = join(root, domain);
    mkdirSync(copy);
    if (existsSync(dir)) {
      const folders = readdirSync(dir).toSorted();
      for (const name of folders.slice(0, -1)) cpSync(join(dir, name), join(copy, name), { recursive: true });
    }
    return { domain, dir: copy };
  });
}

const id = (prefix: string) => `${prefix}_${Bun.randomUUIDv7()}`;
const T = Date.parse("2026-10-01T00:00:00Z");
const LOGIN_TOKEN = "previous-version-login-token";

type Seeded = {
  workspaceId: string;
  botId: string;
  conversationId: string;
  sessionId: string;
  runId: string;
  ownerMessageId: string;
  botMessageId: string;
  attachmentId: string;
  memoryItemId: string;
  secret: string;
};

/** Rows written the way the previous version's schema has them, for one Workspace. */
function seedWorkspace(sqlite: Database, dataDir: string, name: string): Seeded {
  const s: Seeded = {
    workspaceId: id("workspace"),
    botId: id("bot"),
    conversationId: id("conversation"),
    sessionId: id("session"),
    runId: id("run"),
    ownerMessageId: id("message"),
    botMessageId: id("message"),
    attachmentId: id("attachment"),
    memoryItemId: id("memory"),
    secret: `前の版の秘密-${name}`,
  };
  const run = (sql: string, ...params: (string | number | null)[]) => sqlite.run(sql, params);
  run("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)", s.workspaceId, name, T);
  run(
    "INSERT INTO bots (id, workspace_id, name, instructions, model, tools, created_at) VALUES (?, ?, ?, '手伝う', 'sonnet', '[\"memory\"]', ?)",
    s.botId,
    s.workspaceId,
    `${name} の Bot`,
    T,
  );
  run(
    "INSERT INTO conversations (id, workspace_id, created_at) VALUES (?, ?, ?)",
    s.conversationId,
    s.workspaceId,
    T,
  );
  run(
    "INSERT INTO conversation_participants (id, workspace_id, conversation_id, bot_id, role, joined_at) VALUES (?, ?, ?, ?, 'primary', ?)",
    id("participant"),
    s.workspaceId,
    s.conversationId,
    s.botId,
    T,
  );
  run(
    "INSERT INTO sessions (id, workspace_id, conversation_id, bot_id, status, opened_at) VALUES (?, ?, ?, ?, 'open', ?)",
    s.sessionId,
    s.workspaceId,
    s.conversationId,
    s.botId,
    T,
  );
  run(
    "INSERT INTO messages (id, workspace_id, conversation_id, author_kind, text, created_at) VALUES (?, ?, ?, 'owner', ?, ?)",
    s.ownerMessageId,
    s.workspaceId,
    s.conversationId,
    `remember: ${s.secret}`,
    T,
  );
  run(
    "INSERT INTO runs (id, workspace_id, conversation_id, bot_id, session_id, actor_kind, actor_login_id, input_message_id, status, created_at, started_at, finished_at) VALUES (?, ?, ?, ?, ?, 'owner', 'login_previous', ?, 'completed', ?, ?, ?)",
    s.runId,
    s.workspaceId,
    s.conversationId,
    s.botId,
    s.sessionId,
    s.ownerMessageId,
    T,
    T,
    T,
  );
  const reply = `覚えました: ${s.secret}`;
  run(
    "INSERT INTO messages (id, workspace_id, conversation_id, author_kind, bot_id, run_id, text, created_at) VALUES (?, ?, ?, 'bot', ?, ?, ?, ?)",
    s.botMessageId,
    s.workspaceId,
    s.conversationId,
    s.botId,
    s.runId,
    reply,
    T + 1,
  );
  // Events in the shape the previous version logged: no attachments, sessionId or cancelled flag.
  const events = [
    {
      kind: "message_created",
      message: {
        id: s.ownerMessageId,
        conversationId: s.conversationId,
        author: { kind: "owner" },
        text: `remember: ${s.secret}`,
        createdAt: T,
      },
    },
    {
      kind: "run_queued",
      run: {
        id: s.runId,
        conversationId: s.conversationId,
        sessionId: s.sessionId,
        botId: s.botId,
        status: "queued",
        createdAt: T,
      },
    },
    { kind: "run_started", runId: s.runId },
    { kind: "run_delta", runId: s.runId, text: reply },
    {
      kind: "message_created",
      message: {
        id: s.botMessageId,
        conversationId: s.conversationId,
        author: { kind: "bot", botId: s.botId, runId: s.runId },
        text: reply,
        createdAt: T + 1,
      },
    },
    { kind: "run_finished", runId: s.runId, status: "completed" },
  ];
  for (const event of events) {
    run(
      "INSERT INTO conversation_events (workspace_id, conversation_id, run_id, event, created_at) VALUES (?, ?, ?, ?, ?)",
      s.workspaceId,
      s.conversationId,
      event.kind === "message_created" && event.message?.author.kind === "owner" ? null : s.runId,
      JSON.stringify(event),
      T,
    );
  }
  run(
    "INSERT INTO attachments (id, workspace_id, message_id, name, content_type, size, created_at) VALUES (?, ?, ?, 'memo.txt', 'text/plain', ?, ?)",
    s.attachmentId,
    s.workspaceId,
    s.ownerMessageId,
    Buffer.byteLength(s.secret),
    T,
  );
  const dir = join(dataDir, "attachments", s.workspaceId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, s.attachmentId), s.secret, { mode: 0o600 });
  run(
    "INSERT INTO memory_items (id, workspace_id, bot_id, type, title, description, tags, body, created_by, created_run_id, updated_by, updated_run_id, created_at, updated_at) VALUES (?, ?, ?, 'note', ?, '', '[]', ?, 'bot', ?, 'bot', ?, ?, ?)",
    s.memoryItemId,
    s.workspaceId,
    s.botId,
    s.secret,
    s.secret,
    s.runId,
    s.runId,
    T,
    T,
  );
  return s;
}

function tableCounts(sqlite: Database): Record<string, number> {
  const tables = sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'memory_fts%' AND name != 'momo_migrations'",
    )
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      sqlite.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${name}"`).get()!.n,
    ]),
  );
}

/** A data dir whose app.db has the previous version's migrations and rows of two Workspaces. */
function previousVersionDataDir() {
  const dataDir = tempDir("momo-up-");
  const sqlite = openDatabase(join(dataDir, "app.db"));
  migrate(sqlite, previousVersion(appDbDomains));
  const now = Date.now();
  sqlite.run(
    "INSERT INTO logins (id, token_hash, user_agent, created_at, last_used_at, expires_at) VALUES (?, ?, 'momo-test', ?, ?, ?)",
    [id("login"), createHash("sha256").update(LOGIN_TOKEN).digest("hex"), now, now, now + 86_400_000],
  );
  const seeded = [seedWorkspace(sqlite, dataDir, "個人"), seedWorkspace(sqlite, dataDir, "会社 A")];
  const counts = tableCounts(sqlite);
  sqlite.close();
  return { dataDir, seeded, counts };
}

test("the previous version leaves at least one migration of a domain to apply", () => {
  const previous = previousVersion(appDbDomains);
  const missing = appDbDomains.flatMap((source, i) =>
    existsSync(source.dir)
      ? readdirSync(source.dir).filter((m) => !existsSync(join(previous[i]!.dir, m)))
      : [],
  );
  expect(missing.length).toBeGreaterThan(0);
});

test("a database of the previous version keeps its rows and Workspace rules after the current migrations", async () => {
  const { dataDir, seeded, counts } = previousVersionDataDir();

  const b = await startTestBackend({ dataDir, fakeRunnerDelayMs: 0 });
  api = new Api(b, `momo_login=${LOGIN_TOKEN}`);

  const sqlite = openDatabase(join(dataDir, "app.db"));
  try {
    const after = tableCounts(sqlite);
    for (const [table, n] of Object.entries(counts)) expect([table, after[table]]).toEqual([table, n]);
    expect(workspaceOwnedTableProblems(sqlite)).toEqual([]);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const [a, other] = seeded as [Seeded, Seeded];
    expect(() =>
      sqlite.run(
        "INSERT INTO messages (id, workspace_id, conversation_id, author_kind, text, created_at) VALUES (?, ?, ?, 'owner', 'x', 0)",
        [id("message"), other.workspaceId, a.conversationId],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
    expect(() =>
      sqlite.run("UPDATE memory_items SET workspace_id = ? WHERE id = ?", [
        other.workspaceId,
        a.memoryItemId,
      ]),
    ).toThrow(/workspace_id is immutable/);
  } finally {
    sqlite.close();
  }

  const workspaces = await api.ok("/api/workspaces", WorkspaceList);
  expect(workspaces.workspaces.map((w) => w.id).toSorted()).toEqual(
    seeded.map((s) => s.workspaceId).toSorted(),
  );
  for (const s of seeded) {
    const path = `/api/workspaces/${s.workspaceId}`;
    const base = `${path}/conversations/${s.conversationId}`;
    expect((await api.ok(`${path}/bots/${s.botId}`, BotItem)).instructionsVersion).toBe(1);
    expect((await api.ok(`${path}/conversations`, ConversationList)).conversations.map((c) => c.id)).toEqual([
      s.conversationId,
    ]);
    const page = await api.ok(`${base}/messages`, MessagePage);
    expect(page.messages.map((m) => [m.id, m.sessionId, m.attachments.map((x) => x.id)])).toEqual([
      [s.ownerMessageId, s.sessionId, [s.attachmentId]],
      [s.botMessageId, s.sessionId, []],
    ]);
    expect(page.sessions.map((x) => [x.id, x.status, x.botInstructionsVersion])).toEqual([
      [s.sessionId, "open", 1],
    ]);
    expect(await (await api.call(`${base}/attachments/${s.attachmentId}`)).text()).toBe(s.secret);
    expect((await api.ok(`${path}/bots/${s.botId}/memory`, MemoryList)).items.map((i) => i.body)).toEqual([
      s.secret,
    ]);

    const replay = await frames(await api.call(`${base}/events?after=0`), finished(s.runId));
    expect(replay.frames.map((x) => x.event.kind)).toEqual([
      "message_created",
      "run_queued",
      "run_started",
      "run_delta",
      "message_created",
      "run_finished",
    ]);

    const { reply, run } = await api.say(path, base, `recall: ${s.secret}`);
    expect(run.sessionId).toBe(s.sessionId);
    expect(reply).toBe(`見つけた記憶:\n- ${s.secret}`);
  }
  const [a, other] = seeded as [Seeded, Seeded];
  const crossed = await api.call(
    `/api/workspaces/${other.workspaceId}/conversations/${a.conversationId}/messages`,
  );
  expect(crossed.status).toBe(404);
});
