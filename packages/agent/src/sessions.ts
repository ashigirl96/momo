import type { SessionCloseReason, SessionItem } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import {
  getBot,
  getConversation,
  inTenant,
  replaceBotInstructions,
  updateBot,
  type Bot,
  type BotPatch,
  type TenantContext,
} from "@momo/workspace";
import { and, asc, eq } from "drizzle-orm";
import { appendEvent } from "./events.ts";
import { cancelSessionRuns } from "./runs.ts";
import { sessions } from "./schema.ts";

export type Session = typeof sessions.$inferSelect;

export function toSessionItem(session: Session): SessionItem {
  return {
    id: session.id,
    conversationId: session.conversationId,
    botId: session.botId,
    status: session.status,
    botInstructionsVersion: session.botInstructionsVersion,
    openedAt: session.openedAt.getTime(),
    closedAt: session.closedAt?.getTime(),
    closedBy: session.closedBy ?? undefined,
  };
}

function openSessionOf(
  db: Db,
  tenant: TenantContext,
  conversationId: string,
  botId: string,
): Session | undefined {
  return db
    .select()
    .from(sessions)
    .where(
      and(
        inTenant(sessions, tenant),
        eq(sessions.conversationId, conversationId),
        eq(sessions.botId, botId),
        eq(sessions.status, "open"),
      ),
    )
    .get();
}

/**
 * The open Session of the Bot in the Conversation, opened now with the Bot's current instruction
 * version if there is none. Callers check that the Bot takes part in the tenant's Conversation.
 */
export function openSession(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; botId: string; now: Date },
): Session {
  const open = openSessionOf(db, tenant, input.conversationId, input.botId);
  if (open) return open;
  const bot = getBot(db, tenant, input.botId)!;
  return db
    .insert(sessions)
    .values({
      id: `session_${Bun.randomUUIDv7()}`,
      workspaceId: tenant.workspaceId,
      conversationId: input.conversationId,
      botId: input.botId,
      status: "open",
      botInstructionsVersion: bot.instructionsVersion,
      openedAt: input.now,
    })
    .returning()
    .get();
}

export function getSession(db: Db, tenant: TenantContext, id: string): Session | undefined {
  return db
    .select()
    .from(sessions)
    .where(and(inTenant(sessions, tenant), eq(sessions.id, id)))
    .get();
}

/** The Conversation's Sessions, oldest first; empty for a Conversation outside the tenant. */
export function listSessions(db: Db, tenant: TenantContext, conversationId: string): Session[] {
  return db
    .select()
    .from(sessions)
    .where(and(inTenant(sessions, tenant), eq(sessions.conversationId, conversationId)))
    .orderBy(asc(sessions.id))
    .all();
}

export type ClosedSessions = { closed: Session[]; cancelledRunning: string[] };

/** Cancels the Session's unfinished Runs, closes it and tells the Conversation. */
function closeSession(
  db: Db,
  tenant: TenantContext,
  open: Session,
  reason: SessionCloseReason,
  now: Date,
): { closed: Session; cancelledRunning: string[] } {
  const cancelledRunning = cancelSessionRuns(db, tenant, open.id, now);
  const closed = db
    .update(sessions)
    .set({ status: "closed", closedAt: now, closedBy: reason })
    .where(and(inTenant(sessions, tenant), eq(sessions.id, open.id)))
    .returning()
    .get();
  appendEvent(db, tenant, {
    conversationId: closed.conversationId,
    event: { kind: "session_closed", session: toSessionItem(closed) },
    now,
  });
  return { closed, cancelledRunning };
}

/**
 * The owner resets the primary Bot's Session: its unfinished Runs are cancelled and it closes, and
 * the next message opens a new one. Undefined when the Conversation is not the tenant's.
 */
export function resetSession(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; now: Date },
): { closed: Session | undefined; cancelledRunning: string[] } | undefined {
  return db.transaction((tx) => {
    const conversation = getConversation(tx, tenant, input.conversationId);
    if (!conversation) return undefined;
    const open = openSessionOf(tx, tenant, conversation.id, conversation.primaryBotId);
    if (!open) return { closed: undefined, cancelledRunning: [] };
    return closeSession(tx, tenant, open, "reset", input.now);
  });
}

/**
 * Saves a Bot's settings. New instructions bump their version and close the Bot's open Sessions in
 * every Conversation in the same transaction, so no Run goes on with the old instructions (#8).
 */
export function updateBotSettings(
  db: Db,
  tenant: TenantContext,
  botId: string,
  input: BotPatch & { instructions?: string; now: Date },
): ({ bot: Bot; instructionsChanged: boolean } & ClosedSessions) | undefined {
  return db.transaction((tx) => {
    const { instructions, now, ...patch } = input;
    let bot = getBot(tx, tenant, botId);
    if (!bot) return undefined;
    if (Object.keys(patch).length > 0) bot = updateBot(tx, tenant, botId, patch)!;
    const replaced =
      instructions === undefined ? undefined : replaceBotInstructions(tx, tenant, botId, instructions)!;
    if (!replaced?.changed) return { bot, instructionsChanged: false, closed: [], cancelledRunning: [] };
    const open = tx
      .select()
      .from(sessions)
      .where(and(inTenant(sessions, tenant), eq(sessions.botId, botId), eq(sessions.status, "open")))
      .orderBy(asc(sessions.id))
      .all();
    const result: ClosedSessions = { closed: [], cancelledRunning: [] };
    for (const session of open) {
      const { closed, cancelledRunning } = closeSession(tx, tenant, session, "instructions_changed", now);
      result.closed.push(closed);
      result.cancelledRunning.push(...cancelledRunning);
    }
    return { bot: replaced.bot, instructionsChanged: true, ...result };
  });
}
