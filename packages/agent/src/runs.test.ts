import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import {
  createBot,
  createConversation,
  createWorkspace,
  InvalidCursor,
  migrations as workspaceMigrations,
  resolveWorkspaceScope,
  type Conversation,
  type WorkspaceScope,
} from "@momo/workspace";
import { workspaceOwnedTableProblems } from "@momo/workspace/testing";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eventsAfter, streamAfter } from "./events.ts";
import { migrations } from "./index.ts";
import { listMessages } from "./messages.ts";
import { postOwnerMessage } from "./post-message.ts";
import { appendRunDelta, cancelRun, failInterruptedRuns, finishRun, getRun, startNextRun } from "./runs.ts";

const now = new Date("2026-10-01T00:00:00Z");
const later = new Date("2026-10-01T00:00:05Z");
const settings = { instructions: "手伝う", model: "sonnet", tools: [] } as const;

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });
let a: WorkspaceScope;
let b: WorkspaceScope;
let convA: Conversation;
let convB: Conversation;

function workspaceWithConversation(name: string): [WorkspaceScope, Conversation] {
  const scope = resolveWorkspaceScope(db(), createWorkspace(db(), { name, now }).id, {
    kind: "owner",
    loginId: `login_${name}`,
  })!;
  const bot = createBot(db(), scope, { ...settings, name: `${name} の Bot`, tools: [], now });
  return [scope, createConversation(db(), scope, { primaryBotId: bot.id, now })!];
}

beforeEach(() => {
  testDb = migratedTestDatabase([workspaceMigrations, migrations]);
  [a, convA] = workspaceWithConversation("A");
  [b, convB] = workspaceWithConversation("B");
});

afterEach(() => {
  testDb.close();
});

const post = (text: string, scope = a, conversation = convA) =>
  postOwnerMessage(db(), scope, { conversationId: conversation.id, text, now });

const kinds = (scope: WorkspaceScope, conversation: Conversation, after = 0) =>
  eventsAfter(db(), scope, conversation.id, after).map((e) => e.event.kind);

describe("posting an owner message", () => {
  test("queues a Run of the primary Bot in its Session, carrying the trusted ids and the owner", () => {
    const { message, run } = post("こんにちは")!;

    expect(message).toMatchObject({
      conversationId: convA.id,
      author: { kind: "owner" },
      text: "こんにちは",
    });
    expect(run).toMatchObject({
      workspaceId: a.workspaceId,
      conversationId: convA.id,
      botId: convA.primaryBotId,
      status: "queued",
      actorKind: "owner",
      actorLoginId: "login_A",
      inputMessageId: message.id,
    });
    expect(run.id).toMatch(/^run_[0-9a-f-]{36}$/);
    expect(run.sessionId).toMatch(/^session_[0-9a-f-]{36}$/);
    expect(kinds(a, convA)).toEqual(["message_created", "run_queued"]);
  });

  test("keeps using the one open Session of the Conversation and Bot", () => {
    const first = post("1")!.run;
    const second = post("2")!.run;

    expect(second.sessionId).toBe(first.sessionId);
    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO sessions (id, workspace_id, conversation_id, bot_id, status, opened_at) VALUES ('session_x', ?, ?, ?, 'open', 0)",
        [a.workspaceId, convA.id, convA.primaryBotId],
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  test("into another Workspace's Conversation writes nothing", () => {
    expect(post("乗っ取り", b, convA)).toBeUndefined();

    expect(listMessages(db(), a, convA.id, {})!.items).toEqual([]);
    expect(eventsAfter(db(), a, convA.id, 0)).toEqual([]);
  });
});

describe("the Run lifecycle", () => {
  test("Runs of one Session run one at a time, in the order they were queued", () => {
    const first = post("1")!.run;
    const second = post("2")!.run;

    expect(startNextRun(db(), a, first.sessionId, now)?.run.id).toBe(first.id);
    expect(startNextRun(db(), a, first.sessionId, now)).toBeUndefined();
    finishRun(db(), a, first.id, { outcome: "completed", now });
    expect(startNextRun(db(), a, first.sessionId, now)?.run.id).toBe(second.id);
  });

  test("the database refuses a second running Run in a Session", () => {
    const first = post("1")!.run;
    const second = post("2")!.run;
    startNextRun(db(), a, first.sessionId, now);

    expect(() => testDb.sqlite.run("UPDATE runs SET status = 'running' WHERE id = ?", [second.id])).toThrow(
      /UNIQUE constraint failed/,
    );
  });

  test("a started Run gets the Conversation's public messages as its input", () => {
    const first = post("1")!.run;
    startNextRun(db(), a, first.sessionId, now);
    appendRunDelta(db(), a, first.id, "返事", now);
    finishRun(db(), a, first.id, { outcome: "completed", now });
    post("2");

    expect(startNextRun(db(), a, first.sessionId, now)).toMatchObject({
      input: "2",
      history: [
        { author: "owner", text: "1" },
        { author: "bot", text: "返事" },
      ],
    });
  });

  test("a completed Run writes the Bot's message from its streamed text", () => {
    const { message, run } = post("こんにちは")!;
    startNextRun(db(), a, run.sessionId, now);
    expect(appendRunDelta(db(), a, run.id, "**こん", now)).toBe(true);
    expect(appendRunDelta(db(), a, run.id, "にちは**", now)).toBe(true);
    expect(finishRun(db(), a, run.id, { outcome: "completed", now: later })?.status).toBe("completed");

    const history = listMessages(db(), a, convA.id, {})!.items;
    expect(history.map((m) => m.id)[0]).toBe(message.id);
    expect(history[1]).toMatchObject({
      author: { kind: "bot", botId: convA.primaryBotId, runId: run.id },
      text: "**こんにちは**",
      createdAt: later,
    });
    expect(kinds(a, convA)).toEqual([
      "message_created",
      "run_queued",
      "run_started",
      "run_delta",
      "run_delta",
      "message_created",
      "run_finished",
    ]);
  });

  test("only a running Run of the same Workspace takes deltas and finishes", () => {
    const { run } = post("1")!;

    expect(appendRunDelta(db(), a, run.id, "早すぎる", now)).toBe(false);
    startNextRun(db(), a, run.sessionId, now);
    expect(appendRunDelta(db(), b, run.id, "越境", now)).toBe(false);
    expect(finishRun(db(), b, run.id, { outcome: "completed", now })).toBeUndefined();
    expect(getRun(db(), b, run.id)).toBeUndefined();

    finishRun(db(), a, run.id, { outcome: "completed", now });
    expect(appendRunDelta(db(), a, run.id, "遅すぎる", now)).toBe(false);
    expect(finishRun(db(), a, run.id, { outcome: "failed", now })).toBeUndefined();
    expect(getRun(db(), a, run.id)?.status).toBe("completed");
  });

  test("a failed Run writes no Bot message", () => {
    const { run } = post("1")!;
    startNextRun(db(), a, run.sessionId, now);
    appendRunDelta(db(), a, run.id, "途中", now);
    finishRun(db(), a, run.id, { outcome: "failed", now });

    expect(listMessages(db(), a, convA.id, {})!.items).toHaveLength(1);
  });

  test("on startup, Runs left running fail and Sessions with queued Runs are handed back", () => {
    const first = post("1")!.run;
    post("2");
    const other = post("x", b, convB)!.run;
    startNextRun(db(), a, first.sessionId, now);

    expect(failInterruptedRuns(db(), now)).toEqual(
      expect.arrayContaining([
        {
          workspaceId: a.workspaceId,
          sessionId: first.sessionId,
          actor: { kind: "owner", loginId: "login_A" },
        },
        {
          workspaceId: b.workspaceId,
          sessionId: other.sessionId,
          actor: { kind: "owner", loginId: "login_B" },
        },
      ]),
    );
    expect(getRun(db(), a, first.id)?.status).toBe("failed");
    expect(kinds(a, convA).at(-1)).toBe("run_finished");
  });
});

describe("cancelling a Run", () => {
  test("a Run cancelled mid-reply keeps what it wrote as a Bot message marked cancelled", () => {
    const { run } = post("長い話")!;
    startNextRun(db(), a, run.sessionId, now);
    appendRunDelta(db(), a, run.id, "途中ま", now);

    expect(cancelRun(db(), a, run.id, later)?.status).toBe("cancelled");
    expect(appendRunDelta(db(), a, run.id, "で", later)).toBe(false);
    expect(getRun(db(), a, run.id)).toMatchObject({ status: "cancelled", finishedAt: later });
    expect(listMessages(db(), a, convA.id, {})!.items[1]).toMatchObject({
      author: { kind: "bot", runId: run.id, cancelled: true },
      text: "途中ま",
    });
    expect(kinds(a, convA).slice(-2)).toEqual(["message_created", "run_finished"]);
    expect(eventsAfter(db(), a, convA.id, 0).at(-1)?.event).toEqual({
      kind: "run_finished",
      runId: run.id,
      status: "cancelled",
    });
  });

  test("a queued Run is cancelled before it starts and never runs", () => {
    const first = post("1")!.run;
    const second = post("2")!.run;
    startNextRun(db(), a, first.sessionId, now);

    expect(cancelRun(db(), a, second.id, now)?.status).toBe("cancelled");
    finishRun(db(), a, first.id, { outcome: "completed", now });
    expect(startNextRun(db(), a, first.sessionId, now)).toBeUndefined();
    expect(listMessages(db(), a, convA.id, {})!.items.map((m) => m.author.kind)).toEqual(["owner", "owner"]);
  });

  test("a finished Run stays as it finished, and another Workspace's Run is not found", () => {
    const { run } = post("1")!;
    startNextRun(db(), a, run.sessionId, now);
    appendRunDelta(db(), a, run.id, "返事", now);

    expect(cancelRun(db(), b, run.id, now)).toBeUndefined();
    expect(getRun(db(), a, run.id)?.status).toBe("running");
    finishRun(db(), a, run.id, { outcome: "completed", now });
    expect(cancelRun(db(), a, run.id, later)?.status).toBe("completed");
    expect(listMessages(db(), a, convA.id, {})!.items[1]?.author).toMatchObject({ cancelled: false });
  });
});

describe("the event log and history", () => {
  test("events are read only for the Conversation and Workspace asked for, after the given id", () => {
    post("A の発言");
    post("B の発言", b, convB);
    const ids = eventsAfter(db(), a, convA.id, 0).map((e) => e.id);

    expect(eventsAfter(db(), b, convA.id, 0)).toEqual([]);
    expect(eventsAfter(db(), a, convB.id, 0)).toEqual([]);
    expect(eventsAfter(db(), a, convA.id, ids[0]!).map((e) => e.id)).toEqual([ids[1]!]);
    expect(eventsAfter(db(), b, convB.id, 0).every((e) => !ids.includes(e.id))).toBe(true);
  });

  test("the stream starts before an unfinished Run so a reload replays it, else after the last event", () => {
    const { run } = post("1")!;
    const [created, queued] = eventsAfter(db(), a, convA.id, 0);
    startNextRun(db(), a, run.sessionId, now);
    appendRunDelta(db(), a, run.id, "途中", now);

    expect(streamAfter(db(), a, convA.id)).toBe(queued!.id - 1);
    expect(created!.id).toBe(queued!.id - 1);
    finishRun(db(), a, run.id, { outcome: "completed", now });
    expect(streamAfter(db(), a, convA.id)).toBe(eventsAfter(db(), a, convA.id, 0).at(-1)!.id);
    expect(streamAfter(db(), b, convA.id)).toBe(0);
  });

  test("history is oldest first and its cursor is accepted only by the same Workspace and Conversation", () => {
    for (const text of ["1", "2", "3"]) post(text);

    const page1 = listMessages(db(), a, convA.id, { limit: 2 })!;
    expect(page1.items.map((m) => m.text)).toEqual(["1", "2"]);
    expect(listMessages(db(), a, convA.id, { cursor: page1.nextCursor })!.items.map((m) => m.text)).toEqual([
      "3",
    ]);
    expect(listMessages(db(), b, convA.id, {})).toBeUndefined();
    expect(() => listMessages(db(), b, convB.id, { cursor: page1.nextCursor })).toThrow(InvalidCursor);
    const sameWorkspace = createConversation(db(), a, { primaryBotId: convA.primaryBotId, now })!;
    expect(() => listMessages(db(), a, sameWorkspace.id, { cursor: page1.nextCursor })).toThrow(
      InvalidCursor,
    );
  });
});

const rejects = (sql: string, params: string[]) =>
  expect(() => testDb.sqlite.run(sql, params)).toThrow(/FOREIGN KEY constraint failed/);

describe("agent rows in the database", () => {
  test("the agent tables follow every Workspace-owned table rule", () => {
    expect(workspaceOwnedTableProblems(testDb.sqlite)).toEqual([]);
  });

  test("a Session, message or event cannot point at another Workspace's Conversation or Bot", () => {
    const run = post("1")!.run;

    rejects(
      "INSERT INTO sessions (id, workspace_id, conversation_id, bot_id, status, opened_at) VALUES ('session_x', ?, ?, ?, 'closed', 0)",
      [b.workspaceId, convA.id, convA.primaryBotId],
    );
    rejects(
      "INSERT INTO sessions (id, workspace_id, conversation_id, bot_id, status, opened_at) VALUES ('session_y', ?, ?, ?, 'closed', 0)",
      [a.workspaceId, convA.id, convB.primaryBotId],
    );
    rejects(
      "INSERT INTO messages (id, workspace_id, conversation_id, author_kind, bot_id, run_id, text, created_at) VALUES ('message_x', ?, ?, 'bot', ?, ?, 'x', 0)",
      [a.workspaceId, convA.id, convB.primaryBotId, run.id],
    );
    rejects(
      "INSERT INTO messages (id, workspace_id, conversation_id, author_kind, text, created_at) VALUES ('message_y', ?, ?, 'owner', 'x', 0)",
      [b.workspaceId, convA.id],
    );
    rejects(
      "INSERT INTO conversation_events (workspace_id, conversation_id, run_id, event, created_at) VALUES (?, ?, ?, '{}', 0)",
      [b.workspaceId, convB.id, run.id],
    );
  });

  test("a message whose Run cannot be written leaves no message, Session or event behind", () => {
    testDb.sqlite.run("CREATE TRIGGER probe BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'probe'); END");

    expect(() => post("1")).toThrow(/insert into "runs"/);
    expect(listMessages(db(), a, convA.id, {})!.items).toEqual([]);
    expect(eventsAfter(db(), a, convA.id, 0)).toEqual([]);
    expect(testDb.sqlite.query("SELECT count(*) AS n FROM sessions").get()).toEqual({ n: 0 });
  });

  test("a Run whose Bot message cannot be written stays running", () => {
    const { run } = post("1")!;
    startNextRun(db(), a, run.sessionId, now);
    appendRunDelta(db(), a, run.id, "返事", now);
    testDb.sqlite.run(
      "CREATE TRIGGER probe BEFORE INSERT ON messages WHEN NEW.author_kind = 'bot' BEGIN SELECT RAISE(ABORT, 'probe'); END",
    );

    expect(() => finishRun(db(), a, run.id, { outcome: "completed", now })).toThrow(/insert into "messages"/);
    expect(getRun(db(), a, run.id)?.status).toBe("running");
    expect(kinds(a, convA).at(-1)).toBe("run_delta");
  });

  test("a Run cannot be moved to another Workspace", () => {
    const run = post("1")!.run;

    expect(() =>
      testDb.sqlite.run("UPDATE runs SET workspace_id = ? WHERE id = ?", [b.workspaceId, run.id]),
    ).toThrow(/workspace_id is immutable/);
  });
});
