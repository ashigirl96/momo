import { RunnerOutbound, type RunnerInbound, type RunOutcome } from "@momo/contracts";
import { appendRunDelta, failInterruptedRuns, finishRun, startNextRun } from "@momo/agent";
import type { Db } from "@momo/migrator";
import { resolveTenant, type TenantContext } from "@momo/workspace";
import type { ConversationHub } from "./conversation-hub.ts";
import { SessionMailbox, type Runner } from "./mailbox.ts";

type SessionSlot = {
  tenant: TenantContext;
  mailbox: SessionMailbox;
  running?: { runId: string; conversationId: string };
};

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
    slot.running = { runId: run.id, conversationId: run.conversationId };
    this.#hub.notify(run.workspaceId, run.conversationId);
    slot.mailbox.postInbound({
      kind: "run_start",
      runId: run.id,
      input: started.input,
      history: started.history,
    } satisfies RunnerInbound);
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
    if (!running || message.runId !== running.runId) return;
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
        result: { kind: "error", error: "invalid_request", message: "this tool is not available in a Run" },
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
