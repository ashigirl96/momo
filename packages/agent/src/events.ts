import type { ConversationEvent } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { inTenant, type TenantContext } from "@momo/workspace";
import { and, asc, eq, gt, inArray, max, min } from "drizzle-orm";
import { conversationEvents, runs } from "./schema.ts";

export type StoredEvent = { id: number; event: ConversationEvent };

export const EVENT_PAGE_MAX = 500;

/** Appends to the Conversation's event log; callers check the Conversation is in the tenant first. */
export function appendEvent(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; runId?: string; event: ConversationEvent; now: Date },
): number {
  return db
    .insert(conversationEvents)
    .values({
      workspaceId: tenant.workspaceId,
      conversationId: input.conversationId,
      runId: input.runId,
      event: input.event,
      createdAt: input.now,
    })
    .returning({ id: conversationEvents.id })
    .get().id;
}

/** The Conversation's events after `afterId`, oldest first. Another scope's ids are never returned. */
export function eventsAfter(
  db: Db,
  tenant: TenantContext,
  conversationId: string,
  afterId: number,
  limit = EVENT_PAGE_MAX,
): StoredEvent[] {
  return db
    .select({ id: conversationEvents.id, event: conversationEvents.event })
    .from(conversationEvents)
    .where(
      and(
        inTenant(conversationEvents, tenant),
        eq(conversationEvents.conversationId, conversationId),
        gt(conversationEvents.id, afterId),
      ),
    )
    .orderBy(asc(conversationEvents.id))
    .limit(Math.min(Math.max(limit, 1), EVENT_PAGE_MAX))
    .all();
}

/**
 * Where a client that just read the history subscribes from: before the first event of the oldest
 * unfinished Run, so the Run's stream replays, or else after the Conversation's last event.
 */
export function streamAfter(db: Db, tenant: TenantContext, conversationId: string): number {
  const scope = and(
    inTenant(conversationEvents, tenant),
    eq(conversationEvents.conversationId, conversationId),
  );
  const unfinished = db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        inTenant(runs, tenant),
        eq(runs.conversationId, conversationId),
        inArray(runs.status, ["queued", "running"]),
      ),
    );
  const firstOfRun = db
    .select({ id: min(conversationEvents.id) })
    .from(conversationEvents)
    .where(and(scope, inArray(conversationEvents.runId, unfinished)))
    .get()?.id;
  if (firstOfRun != null) return firstOfRun - 1;
  return (
    db
      .select({ id: max(conversationEvents.id) })
      .from(conversationEvents)
      .where(scope)
      .get()?.id ?? 0
  );
}
