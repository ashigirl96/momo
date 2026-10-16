import {
  RunnerOutbound,
  type MemoryHit,
  type RunnerInbound,
  type RunOutcome,
  type ToolRequest,
  type ToolResult,
} from "@momo/contracts";
import {
  appendRunDelta,
  cancelRun,
  failInterruptedRuns,
  finishRun,
  startNextRun,
  type Run,
} from "@momo/agent";
import { searchMemoryItems, writeMemoryItem, type MemoryRow } from "@momo/memory";
import type { Db } from "@momo/migrator";
import { resolveTenant, type TenantContext } from "@momo/workspace";
import type { ConversationHub } from "./conversation-hub.ts";
import { SessionMailbox, type Runner } from "./mailbox.ts";

type RunningRun = { runId: string; conversationId: string; botId: string };

type SessionSlot = {
  tenant: TenantContext;
  mailbox: SessionMailbox;
  running?: RunningRun;
};

const toHit = (item: MemoryRow): MemoryHit => ({
  id: item.id,
  type: item.type,
  title: item.title,
  description: item.description,
  tags: item.tags,
  ...(item.resource === null ? {} : { resource: item.resource }),
  body: item.body,
});

/** Runs a tool for the Run the mailbox is running; its Bot and Workspace come from that Run. */
function runTool(
  db: Db,
  tenant: TenantContext,
  running: RunningRun,
  tool: ToolRequest,
  now: Date,
): ToolResult {
  try {
    if (tool.kind === "memory_write") {
      const item = writeMemoryItem(db, tenant, { runId: running.runId, item: tool.item, now });
      return item
        ? { kind: "memory_written", id: item.id }
        : { kind: "error", error: "not_in_run", message: "the Run is no longer running" };
    }
    if (tool.kind === "memory_search")
      return {
        kind: "memory_found",
        items: searchMemoryItems(db, tenant, running.botId, tool.query).map(toHit),
      };
    return { kind: "error", error: "invalid_request", message: "this tool is not available in a Run" };
  } catch (error) {
    console.error(`run ${running.runId}: tool ${tool.kind} failed: ${(error as Error).message}`);
    return { kind: "error", error: "failed", message: "the tool failed" };
  }
}

/**
 * Drives Runs between app.db and the runner. app.db is the source of truth for the Run lifecycle;
 * this loop only moves each Session's oldest queued Run to the runner and records what comes back.
 */
export class RunLoop {
  readonly #db: Db;
  readonly #runner: Runner;
  readonly #hub: ConversationHub;
  readonly #now: () => Date;
  readonly #sessions = new Map<string, SessionSlot>();
  #stopped = false;

  constructor(options: { db: Db; runner: Runner; hub: ConversationHub; now: () => Date }) {
    this.#db = options.db;
    this.#runner = options.runner;
    this.#hub = options.hub;
    this.#now = options.now;
  }

  /** Fails Runs a previous process left running and resumes Sessions that still have queued Runs. */
  recover(): void {
    for (const queued of failInterruptedRuns(this.#db, this.#now())) {
      const tenant = resolveTenant(this.#db, queued.workspaceId, queued.actor);
      if (tenant) this.kick(tenant, queued.sessionId);
    }
  }

  /** Starts the Session's next Run unless one is already running. */
  kick(tenant: TenantContext, sessionId: string): void {
    if (this.#stopped) return;
    const slot = this.#slot(tenant, sessionId);
    if (slot.running) return;
    const started = startNextRun(this.#db, slot.tenant, sessionId, this.#now());
    if (!started) return;
    const { run } = started;
    slot.running = { runId: run.id, conversationId: run.conversationId, botId: run.botId };
    this.#hub.notify(run.workspaceId, run.conversationId);
    slot.mailbox.postInbound({
      kind: "run_start",
      runId: run.id,
      input: started.input,
      history: started.history,
    } satisfies RunnerInbound);
  }

  /** The owner stops a queued or running Run; undefined when it is not the tenant's. */
  cancel(tenant: TenantContext, runId: string): Run | undefined {
    const run = cancelRun(this.#db, tenant, runId, this.#now());
    if (!run) return undefined;
    this.stopCancelled([run.id]);
    this.#hub.notify(run.workspaceId, run.conversationId);
    return run;
  }

  /**
   * Tells the runner to stop Runs app.db already records as cancelled. Their Session keeps its slot
   * until the runner confirms with run_finished, so the next Run never overlaps the stopping one.
   */
  stopCancelled(runIds: readonly string[]): void {
    for (const slot of this.#sessions.values()) {
      const runId = slot.running?.runId;
      if (runId && runIds.includes(runId)) slot.mailbox.postInbound({ kind: "cancel", runId });
    }
  }

  stop(): void {
    this.#stopped = true;
    this.#runner.stop();
  }

  #slot(tenant: TenantContext, sessionId: string): SessionSlot {
    const existing = this.#sessions.get(sessionId);
    if (existing) return existing;
    const slot: SessionSlot = { tenant, mailbox: new SessionMailbox() };
    slot.mailbox.onOutbound((raw) => this.#receive(sessionId, slot, raw));
    this.#runner.attach(slot.mailbox);
    this.#sessions.set(sessionId, slot);
    return slot;
  }

  /** Acts only on valid messages about the Run this Session's mailbox is running. */
  #receive(sessionId: string, slot: SessionSlot, raw: unknown): void {
    if (this.#stopped) return;
    const parsed = RunnerOutbound.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    const running = slot.running;
    if (!running || message.runId !== running.runId) {
      if (message.kind === "tool_request" && message.runId !== undefined)
        slot.mailbox.postInbound({
          kind: "tool_result",
          runId: message.runId,
          requestId: message.requestId,
          result: { kind: "error", error: "not_in_run", message: "no such Run is running in this Session" },
        });
      return;
    }
    const now = this.#now();
    if (message.kind === "stream_delta") {
      if (appendRunDelta(this.#db, slot.tenant, running.runId, message.text, now))
        this.#hub.notify(slot.tenant.workspaceId, running.conversationId);
      return;
    }
    if (message.kind === "tool_request") {
      slot.mailbox.postInbound({
        kind: "tool_result",
        runId: running.runId,
        requestId: message.requestId,
        result: runTool(this.#db, slot.tenant, running, message.tool, now),
      });
      return;
    }
    this.#finish(sessionId, slot, message.outcome);
  }

  #finish(sessionId: string, slot: SessionSlot, outcome: RunOutcome): void {
    const running = slot.running!;
    try {
      finishRun(this.#db, slot.tenant, running.runId, { outcome, now: this.#now() });
    } catch (error) {
      if (this.#stopped || outcome === "failed") throw error;
      console.error(`run ${running.runId}: could not record ${outcome}: ${(error as Error).message}`);
      finishRun(this.#db, slot.tenant, running.runId, { outcome: "failed", now: this.#now() });
    }
    slot.running = undefined;
    this.#hub.notify(slot.tenant.workspaceId, running.conversationId);
    this.kick(slot.tenant, sessionId);
  }
}
