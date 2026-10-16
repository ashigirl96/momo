import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import {
  createBot,
  createConversation,
  createWorkspace,
  getBot,
  migrations as workspaceMigrations,
  resolveWorkspaceScope,
  type Bot,
  type Conversation,
  type WorkspaceScope,
} from "@momo/workspace";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eventsAfter } from "./events.ts";
import { migrations } from "./index.ts";
import { listMessages } from "./messages.ts";
import { postOwnerMessage } from "./post-message.ts";
import { appendRunDelta, finishRun, getRun, startNextRun } from "./runs.ts";
import { getSession, listSessions, resetSession, updateBotSettings } from "./sessions.ts";

const now = new Date("2026-10-01T00:00:00Z");
const later = new Date("2026-10-01T00:00:05Z");

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });
let a: WorkspaceScope;
let b: WorkspaceScope;
let botA: Bot;
let convA: Conversation;

function workspace(name: string): WorkspaceScope {
  return resolveWorkspaceScope(db(), createWorkspace(db(), { name, now }).id, {
    kind: "owner",
    loginId: `login_${name}`,
  })!;
}

function botWithConversation(scope: WorkspaceScope, name: string): [Bot, Conversation] {
  const bot = createBot(db(), scope, { name, instructions: "手伝う", model: "sonnet", tools: [], now });
  return [bot, createConversation(db(), scope, { primaryBotId: bot.id, now })!];
}

beforeEach(() => {
  testDb = migratedTestDatabase([workspaceMigrations, migrations]);
  a = workspace("A");
  b = workspace("B");
  [botA, convA] = botWithConversation(a, "A の Bot");
  botWithConversation(b, "B の Bot");
});

afterEach(() => {
  testDb.close();
});

const post = (text: string, scope = a, conversation = convA) =>
  postOwnerMessage(db(), scope, { conversationId: conversation.id, text, now })!;

function reply(scope: WorkspaceScope, sessionId: string, text: string) {
  const started = startNextRun(db(), scope, sessionId, now)!;
  appendRunDelta(db(), scope, started.run.id, text, now);
  finishRun(db(), scope, started.run.id, { outcome: "completed", now });
  return started;
}

describe("resetting a Session", () => {
  test("closes the open Session and the Conversation goes on in a new one without the old context", () => {
    const first = post("1").run;
    reply(a, first.sessionId, "返事");

    const reset = resetSession(db(), a, { conversationId: convA.id, now: later })!;
    expect(reset.closed).toMatchObject({
      id: first.sessionId,
      status: "closed",
      closedAt: later,
      closedBy: "reset",
    });

    const next = post("2").run;
    expect(next.sessionId).not.toBe(first.sessionId);
    expect(startNextRun(db(), a, next.sessionId, now)).toMatchObject({ input: "2", history: [] });
    expect(listSessions(db(), a, convA.id).map((s) => [s.id, s.status])).toEqual([
      [first.sessionId, "closed"],
      [next.sessionId, "open"],
    ]);
  });

  test("keeps the closed Session's public messages in the history, each naming its Session", () => {
    const first = post("1").run;
    reply(a, first.sessionId, "返事");
    resetSession(db(), a, { conversationId: convA.id, now });
    const next = post("2").run;

    expect(listMessages(db(), a, convA.id, {})!.items.map((m) => [m.text, m.sessionId])).toEqual([
      ["1", first.sessionId],
      ["返事", first.sessionId],
      ["2", next.sessionId],
    ]);
  });

  test("cancels the running and queued Runs of the closed Session", () => {
    const first = post("1").run;
    const second = post("2").run;
    startNextRun(db(), a, first.sessionId, now);
    appendRunDelta(db(), a, first.id, "途中", now);

    const reset = resetSession(db(), a, { conversationId: convA.id, now })!;
    expect(reset.cancelledRunning).toEqual([first.id]);
    expect(getRun(db(), a, first.id)?.status).toBe("cancelled");
    expect(getRun(db(), a, second.id)?.status).toBe("cancelled");
    expect(eventsAfter(db(), a, convA.id, 0).at(-1)?.event).toMatchObject({
      kind: "session_closed",
      session: { id: first.sessionId, closedBy: "reset" },
    });
  });

  test("with no open Session closes nothing", () => {
    expect(resetSession(db(), a, { conversationId: convA.id, now })).toEqual({
      closed: undefined,
      cancelledRunning: [],
    });
  });

  test("of another Workspace's Conversation is refused and changes nothing", () => {
    const run = post("1").run;

    expect(resetSession(db(), b, { conversationId: convA.id, now })).toBeUndefined();
    expect(getSession(db(), a, run.sessionId)?.status).toBe("open");
    expect(getRun(db(), a, run.id)?.status).toBe("queued");
    expect(listSessions(db(), b, convA.id)).toEqual([]);
  });

  test("a closed Session is read-only in the database: it takes no Run and cannot reopen", () => {
    const run = post("1").run;
    resetSession(db(), a, { conversationId: convA.id, now });

    expect(() =>
      testDb.sqlite.run("UPDATE sessions SET status = 'open' WHERE id = ?", [run.sessionId]),
    ).toThrow(/a closed Session is read-only/);
    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO runs (id, workspace_id, conversation_id, bot_id, session_id, actor_kind, actor_login_id, input_message_id, status, created_at) VALUES ('run_x', ?, ?, ?, ?, 'owner', 'login_A', ?, 'queued', 0)",
        [a.workspaceId, convA.id, convA.primaryBotId, run.sessionId, run.inputMessageId],
      ),
    ).toThrow(/a Run needs an open Session/);
  });
});

describe("changing a Bot's instructions", () => {
  test("bumps the instruction version and renews the Bot's open Sessions in every Conversation", () => {
    const other = createConversation(db(), a, { primaryBotId: botA.id, now })!;
    const inA = post("1").run;
    const inOther = post("x", a, other).run;
    expect(getSession(db(), a, inA.sessionId)?.botInstructionsVersion).toBe(1);

    const changed = updateBotSettings(db(), a, botA.id, { instructions: "丁寧に手伝う", now: later })!;
    expect(changed.bot).toMatchObject({ instructions: "丁寧に手伝う", instructionsVersion: 2 });
    expect(changed.closed.map((s) => [s.id, s.closedBy]).toSorted()).toEqual(
      [
        [inA.sessionId, "instructions_changed"],
        [inOther.sessionId, "instructions_changed"],
      ].toSorted(),
    );
    expect(getSession(db(), a, post("2").run.sessionId)?.botInstructionsVersion).toBe(2);
    expect(eventsAfter(db(), a, other.id, 0).at(-1)?.event).toMatchObject({ kind: "session_closed" });
  });

  test("other settings, or the same instructions again, keep the Session", () => {
    const run = post("1").run;

    const renamed = updateBotSettings(db(), a, botA.id, { name: "新しい名前", instructions: "手伝う", now })!;
    expect(renamed.closed).toEqual([]);
    expect(renamed.bot).toMatchObject({ name: "新しい名前", instructionsVersion: 1 });
    expect(getSession(db(), a, run.sessionId)?.status).toBe("open");
  });

  test("of another Workspace's Bot is refused and changes nothing", () => {
    const run = post("1").run;

    expect(updateBotSettings(db(), b, botA.id, { instructions: "乗っ取り", now })).toBeUndefined();
    expect(getBot(db(), a, botA.id)).toMatchObject({ instructions: "手伝う", instructionsVersion: 1 });
    expect(getSession(db(), a, run.sessionId)?.status).toBe("open");
  });

  test("is one transaction: if a Session cannot close, the instructions stay as they were", () => {
    post("1");
    testDb.sqlite.run(
      "CREATE TRIGGER probe BEFORE UPDATE OF status ON sessions BEGIN SELECT RAISE(ABORT, 'probe'); END",
    );

    expect(() => updateBotSettings(db(), a, botA.id, { instructions: "新しい指示", now })).toThrow(
      /update "sessions"/,
    );
    expect(getBot(db(), a, botA.id)).toMatchObject({ instructions: "手伝う", instructionsVersion: 1 });
  });
});
