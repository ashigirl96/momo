import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrations as agentMigrations, postOwnerMessage } from "@momo/agent";
import { RunnerInbound, type MemoryItemDraft, type RunnerOutbound, type ToolResult } from "@momo/contracts";
import { listMemoryItems, migrations as memoryMigrations } from "@momo/memory";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import {
  createBot,
  createConversation,
  createWorkspace,
  migrations as workspaceMigrations,
  resolveTenant,
  type Bot,
  type TenantContext,
} from "@momo/workspace";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { ConversationHub } from "./conversation-hub.ts";
import type { Runner, SessionMailbox } from "./mailbox.ts";
import { RunLoop } from "./run-loop.ts";

const now = new Date("2026-10-01T00:00:00Z");

/** A runner the test drives by hand: it records every Run start and tool result per mailbox. */
class ScriptedRunner implements Runner {
  readonly mailboxes: { mailbox: SessionMailbox; inbound: RunnerInbound[] }[] = [];

  attach(mailbox: SessionMailbox): void {
    const entry = { mailbox, inbound: [] as RunnerInbound[] };
    this.mailboxes.push(entry);
    mailbox.onInbound((raw) => entry.inbound.push(RunnerInbound.parse(raw)));
  }

  stop(): void {}
}

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });
let runner: ScriptedRunner;
let loop: RunLoop;
let tenant: TenantContext;
let bot: Bot;

beforeEach(() => {
  testDb = migratedTestDatabase([workspaceMigrations, agentMigrations, memoryMigrations]);
  tenant = resolveTenant(db(), createWorkspace(db(), { name: "A", now }).id, {
    kind: "owner",
    loginId: "login_a",
  })!;
  bot = createBot(db(), tenant, {
    name: "Bot",
    instructions: "手伝う",
    model: "sonnet",
    tools: ["memory"],
    now,
  });
  runner = new ScriptedRunner();
  loop = new RunLoop({ db: db(), runner, hub: new ConversationHub(), now: () => now });
});

afterEach(() => {
  loop.stop();
  testDb.close();
});

/** Posts a message in a new Conversation and lets the loop start its Run on a new mailbox. */
async function startRun() {
  const conversation = createConversation(db(), tenant, { primaryBotId: bot.id, now })!;
  const { run } = postOwnerMessage(db(), tenant, { conversationId: conversation.id, text: "やあ", now })!;
  loop.kick(tenant, run.sessionId);
  await Bun.sleep(0);
  return { runId: run.id, entry: runner.mailboxes.at(-1)! };
}

const item: MemoryItemDraft = {
  type: "note",
  title: "合言葉",
  description: "",
  tags: [],
  body: "合言葉はさくら",
};

async function ask(entry: { mailbox: SessionMailbox; inbound: RunnerInbound[] }, message: RunnerOutbound) {
  entry.mailbox.postOutbound(message);
  await Bun.sleep(0);
  await Bun.sleep(0);
  return entry.inbound.filter((m) => m.kind === "tool_result").at(-1)?.result as ToolResult | undefined;
}

describe("memory tool requests on a Session mailbox", () => {
  test("a write inside the running Run is executed without approval and answered on the same mailbox", async () => {
    const { runId, entry } = await startRun();

    const result = await ask(entry, {
      kind: "tool_request",
      runId,
      requestId: "req_1",
      tool: { kind: "memory_write", item },
    });

    const [written] = listMemoryItems(db(), tenant, bot.id, {}).items;
    expect(result).toEqual({ kind: "memory_written", id: written!.id });
    expect(written).toMatchObject({ body: "合言葉はさくら", createdRunId: runId, createdBy: "bot" });
    expect(entry.inbound.at(-1)).toMatchObject({ kind: "tool_result", runId, requestId: "req_1" });
  });

  test("a search inside the running Run returns the Bot's items", async () => {
    const first = await startRun();
    await ask(first.entry, {
      kind: "tool_request",
      runId: first.runId,
      requestId: "r1",
      tool: { kind: "memory_write", item },
    });
    const second = await startRun();

    const result = await ask(second.entry, {
      kind: "tool_request",
      runId: second.runId,
      requestId: "r2",
      tool: { kind: "memory_search", query: "さくら" },
    });

    expect(result).toMatchObject({
      kind: "memory_found",
      items: [{ body: "合言葉はさくら", title: "合言葉" }],
    });
  });

  test("a request outside a Run, or naming another mailbox's Run, writes nothing", async () => {
    const first = await startRun();
    const second = await startRun();

    await ask(first.entry, { kind: "tool_request", requestId: "r1", tool: { kind: "memory_write", item } });
    const crossed = await ask(first.entry, {
      kind: "tool_request",
      runId: second.runId,
      requestId: "r2",
      tool: { kind: "memory_write", item },
    });

    expect(crossed).toEqual({ kind: "error", error: "not_in_run", message: expect.any(String) });
    expect(second.entry.inbound.filter((m) => m.kind === "tool_result")).toEqual([]);
    expect(listMemoryItems(db(), tenant, bot.id, {}).items).toEqual([]);
  });

  test("a request after its Run finished writes nothing", async () => {
    const { runId, entry } = await startRun();
    entry.mailbox.postOutbound({
      kind: "run_finished",
      runId,
      outcome: "completed",
    } satisfies RunnerOutbound);
    await Bun.sleep(0);

    const result = await ask(entry, {
      kind: "tool_request",
      runId,
      requestId: "late",
      tool: { kind: "memory_write", item },
    });

    expect(result).toMatchObject({ kind: "error", error: "not_in_run" });
    expect(listMemoryItems(db(), tenant, bot.id, {}).items).toEqual([]);
  });

  test("a request that fails the wire schema is ignored", async () => {
    const { runId, entry } = await startRun();

    entry.mailbox.postOutbound({
      kind: "tool_request",
      runId,
      requestId: "bad",
      tool: { kind: "memory_write", item: { ...item, botId: "bot_other" } },
    });
    await Bun.sleep(0);

    expect(entry.inbound.filter((m) => m.kind === "tool_result")).toEqual([]);
    expect(listMemoryItems(db(), tenant, bot.id, {}).items).toEqual([]);
  });
});
