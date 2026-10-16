import type { ConversationEvent } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { inWorkspace, type WorkspaceScope } from "@momo/workspace";
import { and, asc, eq, gt, inArray, max, min } from "drizzle-orm";
import { conversationEvents, runs } from "./schema.ts";

export type StoredEvent = { id: number; event: ConversationEvent };

export const EVENT_PAGE_MAX = 500;

/** Callers check the Conversation is in the Workspace first. */
export function appendEvent(
  db: Db,
  scope: WorkspaceScope,
  input: { conversationId: string; runId?: string; event: ConversationEvent; now: Date },
): number {
  return db
    .insert(conversationEvents)
    .values({
      workspaceId: scope.workspaceId,
      conversationId: input.conversationId,
      runId: input.runId,
      event: input.event,
      createdAt: input.now,
    })
    .returning({ id: conversationEvents.id })
    .get().id;
}

export function eventsAfter(
  db: Db,
  scope: WorkspaceScope,
  conversationId: string,
  afterId: number,
  limit = EVENT_PAGE_MAX,
): StoredEvent[] {
  return db
    .select({ id: conversationEvents.id, event: conversationEvents.event })
    .from(conversationEvents)
    .where(
      and(
        inWorkspace(conversationEvents, scope),
        eq(conversationEvents.conversationId, conversationId),
        gt(conversationEvents.id, afterId),
      ),
    )
    .orderBy(asc(conversationEvents.id))
    .limit(Math.min(Math.max(limit, 1), EVENT_PAGE_MAX))
    .all();
}

/** Before the first event of the oldest unfinished Run, so a reload replays that Run's stream. */
export function streamAfter(db: Db, scope: WorkspaceScope, conversationId: string): number {
  const inConversation = and(
    inWorkspace(conversationEvents, scope),
    eq(conversationEvents.conversationId, conversationId),
  );
  const unfinished = db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        inWorkspace(runs, scope),
        eq(runs.conversationId, conversationId),
        inArray(runs.status, ["queued", "running"]),
      ),
    );
  const firstOfRun = db
    .select({ id: min(conversationEvents.id) })
    .from(conversationEvents)
    .where(and(inConversation, inArray(conversationEvents.runId, unfinished)))
    .get()?.id;
  if (firstOfRun != null) return firstOfRun - 1;
  return (
    db
      .select({ id: max(conversationEvents.id) })
      .from(conversationEvents)
      .where(inConversation)
      .get()?.id ?? 0
  );
}
