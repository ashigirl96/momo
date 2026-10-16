import type { RunInputMessage, RunItem, RunOutcome } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { inWorkspace, type Actor, type WorkspaceScope } from "@momo/workspace";
import { and, asc, eq, inArray } from "drizzle-orm";
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

export function getRun(db: Db, workspaceScope: WorkspaceScope, id: string): Run | undefined {
  return db
    .select()
    .from(runs)
    .where(and(inWorkspace(runs, workspaceScope), eq(runs.id, id)))
    .get();
}

/** The ids come from rows the caller already found in the Workspace. */
export function queueRun(
  db: Db,
  workspaceScope: WorkspaceScope,
  input: { conversationId: string; botId: string; sessionId: string; inputMessageId: string; now: Date },
): Run {
  const run = db
    .insert(runs)
    .values({
      id: `run_${Bun.randomUUIDv7()}`,
      workspaceId: workspaceScope.workspaceId,
      conversationId: input.conversationId,
      botId: input.botId,
      sessionId: input.sessionId,
      actorKind: workspaceScope.actor.kind,
      actorLoginId: workspaceScope.actor.loginId,
      inputMessageId: input.inputMessageId,
      status: "queued",
      createdAt: input.now,
    })
    .returning()
    .get();
  appendEvent(db, workspaceScope, {
    conversationId: run.conversationId,
    runId: run.id,
    event: { kind: "run_queued", run: toRunItem(run) },
    now: input.now,
  });
  return run;
}

/** A Session runs its Runs one at a time so their effects are attributed to the right Run (ADR-0018). */
export function startNextRun(
  db: Db,
  workspaceScope: WorkspaceScope,
  sessionId: string,
  now: Date,
): StartedRun | undefined {
  return db.transaction((tx) => {
    const inSession = and(inWorkspace(runs, workspaceScope), eq(runs.sessionId, sessionId));
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
      .where(and(inWorkspace(runs, workspaceScope), eq(runs.id, next.id)))
      .returning()
      .get();
    appendEvent(tx, workspaceScope, {
      conversationId: run.conversationId,
      runId: run.id,
      event: { kind: "run_started", runId: run.id },
      now,
    });
    const inSessionMessages = conversationMessages(tx, workspaceScope, run.conversationId).filter(
      (m) => m.sessionId === run.sessionId,
    );
    const inputAt = inSessionMessages.findIndex((m) => m.id === run.inputMessageId);
    const history = inSessionMessages
      .slice(0, inputAt)
      .map((m): RunInputMessage => ({ author: m.author.kind, text: m.text }));
    return { run, input: inSessionMessages[inputAt]!.text, history };
  });
}

function runningRun(db: Db, workspaceScope: WorkspaceScope, runId: string): Run | undefined {
  return db
    .select()
    .from(runs)
    .where(and(inWorkspace(runs, workspaceScope), eq(runs.id, runId), eq(runs.status, "running")))
    .get();
}

export function appendRunDelta(
  db: Db,
  workspaceScope: WorkspaceScope,
  runId: string,
  text: string,
  now: Date,
): boolean {
  return db.transaction((tx) => {
    const run = runningRun(tx, workspaceScope, runId);
    if (!run) return false;
    appendEvent(tx, workspaceScope, {
      conversationId: run.conversationId,
      runId: run.id,
      event: { kind: "run_delta", runId: run.id, text },
      now,
    });
    return true;
  });
}

function streamedText(db: Db, workspaceScope: WorkspaceScope, runId: string): string {
  return db
    .select({ event: conversationEvents.event })
    .from(conversationEvents)
    .where(and(inWorkspace(conversationEvents, workspaceScope), eq(conversationEvents.runId, runId)))
    .orderBy(asc(conversationEvents.id))
    .all()
    .map(({ event }) => (event.kind === "run_delta" ? event.text : ""))
    .join("");
}

/** The streamed text becomes the Bot's message in the same transaction, so the history never shows the Run without it. */
function endRun(
  db: Db,
  workspaceScope: WorkspaceScope,
  unfinished: Run,
  outcome: RunOutcome,
  now: Date,
): Run {
  const text = streamedText(db, workspaceScope, unfinished.id);
  if (outcome !== "failed" && text !== "") {
    const message = insertMessage(db, workspaceScope, {
      conversationId: unfinished.conversationId,
      author: {
        kind: "bot",
        botId: unfinished.botId,
        runId: unfinished.id,
        cancelled: outcome === "cancelled",
      },
      sessionId: unfinished.sessionId,
      text,
      now,
    });
    appendEvent(db, workspaceScope, {
      conversationId: unfinished.conversationId,
      runId: unfinished.id,
      event: { kind: "message_created", message: toMessageItem(message) },
      now,
    });
  }
  const run = db
    .update(runs)
    .set({ status: outcome, finishedAt: now })
    .where(and(inWorkspace(runs, workspaceScope), eq(runs.id, unfinished.id)))
    .returning()
    .get();
  appendEvent(db, workspaceScope, {
    conversationId: run.conversationId,
    runId: run.id,
    event: { kind: "run_finished", runId: run.id, status: run.status },
    now,
  });
  return run;
}

export function finishRun(
  db: Db,
  workspaceScope: WorkspaceScope,
  runId: string,
  input: { outcome: RunOutcome; now: Date },
): Run | undefined {
  return db.transaction((tx) => {
    const running = runningRun(tx, workspaceScope, runId);
    return running && endRun(tx, workspaceScope, running, input.outcome, input.now);
  });
}

/** app.db records the stop at once, so a reload shows it whether or not the runner answers the cancel. */
export function cancelRun(db: Db, workspaceScope: WorkspaceScope, runId: string, now: Date): Run | undefined {
  return db.transaction((tx) => {
    const run = getRun(tx, workspaceScope, runId);
    if (!run || (run.status !== "queued" && run.status !== "running")) return run;
    return endRun(tx, workspaceScope, run, "cancelled", now);
  });
}

export function cancelSessionRuns(
  db: Db,
  workspaceScope: WorkspaceScope,
  sessionId: string,
  now: Date,
): string[] {
  const unfinished = db
    .select()
    .from(runs)
    .where(
      and(
        inWorkspace(runs, workspaceScope),
        eq(runs.sessionId, sessionId),
        inArray(runs.status, ["queued", "running"]),
      ),
    )
    .orderBy(asc(runs.id))
    .all();
  for (const run of unfinished) endRun(db, workspaceScope, run, "cancelled", now);
  return unfinished.filter((run) => run.status === "running").map((run) => run.id);
}

export type QueuedSession = { workspaceId: string; sessionId: string; actor: Actor };

/** A Run left running by a stopped backend has lost its runner, so it fails. */
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
