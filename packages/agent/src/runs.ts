import type { RunInputMessage, RunItem, RunOutcome } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { inTenant, type Actor, type TenantContext } from "@momo/workspace";
import { and, asc, eq } from "drizzle-orm";
import { appendEvent } from "./events.ts";
import { conversationMessages, insertMessage, toMessageItem } from "./messages.ts";
import { conversationEvents, runs } from "./schema.ts";

export type Run = typeof runs.$inferSelect;

export type StartedRun = { run: Run; input: string; history: RunInputMessage[] };

export function toRunItem(run: Run): RunItem {
  return {
    id: run.id,
    conversationId: run.conversationId,
    sessionId: run.sessionId,
    botId: run.botId,
    status: run.status,
    createdAt: run.createdAt.getTime(),
  };
}

export function getRun(db: Db, tenant: TenantContext, id: string): Run | undefined {
  return db
    .select()
    .from(runs)
    .where(and(inTenant(runs, tenant), eq(runs.id, id)))
    .get();
}

/** Queues a Run for an owner message; the ids come from rows the caller already found in the tenant. */
export function queueRun(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; botId: string; sessionId: string; inputMessageId: string; now: Date },
): Run {
  const run = db
    .insert(runs)
    .values({
      id: `run_${Bun.randomUUIDv7()}`,
      workspaceId: tenant.workspaceId,
      conversationId: input.conversationId,
      botId: input.botId,
      sessionId: input.sessionId,
      actorKind: tenant.actor.kind,
      actorLoginId: tenant.actor.loginId,
      inputMessageId: input.inputMessageId,
      status: "queued",
      createdAt: input.now,
    })
    .returning()
    .get();
  appendEvent(db, tenant, {
    conversationId: run.conversationId,
    runId: run.id,
    event: { kind: "run_queued", run: toRunItem(run) },
    now: input.now,
  });
  return run;
}

/**
 * Starts the Session's oldest queued Run, unless one is already running: a Session runs its Runs
 * one at a time so their effects are attributed to the right Run (ADR-0018).
 */
export function startNextRun(
  db: Db,
  tenant: TenantContext,
  sessionId: string,
  now: Date,
): StartedRun | undefined {
  return db.transaction((tx) => {
    const inSession = and(inTenant(runs, tenant), eq(runs.sessionId, sessionId));
    if (
      tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(inSession, eq(runs.status, "running")))
        .get()
    )
      return undefined;
    const next = tx
      .select()
      .from(runs)
      .where(and(inSession, eq(runs.status, "queued")))
      .orderBy(asc(runs.id))
      .get();
    if (!next) return undefined;
    const run = tx
      .update(runs)
      .set({ status: "running", startedAt: now })
      .where(and(inTenant(runs, tenant), eq(runs.id, next.id)))
      .returning()
      .get();
    appendEvent(tx, tenant, {
      conversationId: run.conversationId,
      runId: run.id,
      event: { kind: "run_started", runId: run.id },
      now,
    });
    const all = conversationMessages(tx, tenant, run.conversationId);
    const inputAt = all.findIndex((m) => m.id === run.inputMessageId);
    const history = all
      .slice(0, inputAt)
      .map((m): RunInputMessage => ({ author: m.author.kind, text: m.text }));
    return { run, input: all[inputAt]!.text, history };
  });
}

function runningRun(db: Db, tenant: TenantContext, runId: string): Run | undefined {
  return db
    .select()
    .from(runs)
    .where(and(inTenant(runs, tenant), eq(runs.id, runId), eq(runs.status, "running")))
    .get();
}

/** Records streamed text of a running Run; false when the Run is not running in the tenant. */
export function appendRunDelta(
  db: Db,
  tenant: TenantContext,
  runId: string,
  text: string,
  now: Date,
): boolean {
  return db.transaction((tx) => {
    const run = runningRun(tx, tenant, runId);
    if (!run) return false;
    appendEvent(tx, tenant, {
      conversationId: run.conversationId,
      runId: run.id,
      event: { kind: "run_delta", runId: run.id, text },
      now,
    });
    return true;
  });
}

function streamedText(db: Db, tenant: TenantContext, runId: string): string {
  return db
    .select({ event: conversationEvents.event })
    .from(conversationEvents)
    .where(and(inTenant(conversationEvents, tenant), eq(conversationEvents.runId, runId)))
    .orderBy(asc(conversationEvents.id))
    .all()
    .map(({ event }) => (event.kind === "run_delta" ? event.text : ""))
    .join("");
}

/**
 * Finishes a running Run. A completed Run's streamed text becomes the Bot's public message in the
 * same transaction, so the history never shows a finished Run without its message.
 */
export function finishRun(
  db: Db,
  tenant: TenantContext,
  runId: string,
  input: { outcome: RunOutcome; now: Date },
): Run | undefined {
  return db.transaction((tx) => {
    const running = runningRun(tx, tenant, runId);
    if (!running) return undefined;
    const text = streamedText(tx, tenant, runId);
    if (input.outcome === "completed" && text !== "") {
      const message = insertMessage(tx, tenant, {
        conversationId: running.conversationId,
        author: { kind: "bot", botId: running.botId, runId: running.id },
        text,
        now: input.now,
      });
      appendEvent(tx, tenant, {
        conversationId: running.conversationId,
        runId: running.id,
        event: { kind: "message_created", message: toMessageItem(message) },
        now: input.now,
      });
    }
    const run = tx
      .update(runs)
      .set({ status: input.outcome, finishedAt: input.now })
      .where(and(inTenant(runs, tenant), eq(runs.id, runId)))
      .returning()
      .get();
    appendEvent(tx, tenant, {
      conversationId: run.conversationId,
      runId: run.id,
      event: { kind: "run_finished", runId: run.id, status: run.status },
      now: input.now,
    });
    return run;
  });
}

export type QueuedSession = { workspaceId: string; sessionId: string; actor: Actor };

/**
 * Startup recovery across all Workspaces, before any request is served: a Run left running by a
 * stopped backend has lost its runner, so it fails. Returns the Sessions that still have queued Runs.
 */
export function failInterruptedRuns(db: Db, now: Date): QueuedSession[] {
  return db.transaction((tx) => {
    const interrupted = tx.select().from(runs).where(eq(runs.status, "running")).all();
    for (const run of interrupted) {
      tx.update(runs).set({ status: "failed", finishedAt: now }).where(eq(runs.id, run.id)).run();
      tx.insert(conversationEvents)
        .values({
          workspaceId: run.workspaceId,
          conversationId: run.conversationId,
          runId: run.id,
          event: { kind: "run_finished", runId: run.id, status: "failed" },
          createdAt: now,
        })
        .run();
    }
    const queued = tx.select().from(runs).where(eq(runs.status, "queued")).orderBy(asc(runs.id)).all();
    const bySession = new Map<string, QueuedSession>();
    for (const run of queued) {
      if (bySession.has(run.sessionId)) continue;
      bySession.set(run.sessionId, {
        workspaceId: run.workspaceId,
        sessionId: run.sessionId,
        actor: { kind: run.actorKind, loginId: run.actorLoginId },
      });
    }
    return [...bySession.values()];
  });
}
