import type { SessionCloseReason, SessionItem } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import {
  getBot,
  getConversation,
  inWorkspace,
  replaceBotInstructions,
  updateBot,
  type Bot,
  type BotPatch,
  type WorkspaceScope,
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
  scope: WorkspaceScope,
  conversationId: string,
  botId: string,
): Session | undefined {
  return db
    .select()
    .from(sessions)
    .where(
      and(
        inWorkspace(sessions, scope),
        eq(sessions.conversationId, conversationId),
        eq(sessions.botId, botId),
        eq(sessions.status, "open"),
      ),
    )
    .get();
}

/** Callers check that the Bot takes part in the scope's Conversation. */
export function openSession(
  db: Db,
  scope: WorkspaceScope,
  input: { conversationId: string; botId: string; now: Date },
): Session {
  const open = openSessionOf(db, scope, input.conversationId, input.botId);
  if (open) return open;
  const bot = getBot(db, scope, input.botId)!;
  return db
    .insert(sessions)
    .values({
      id: `session_${Bun.randomUUIDv7()}`,
      workspaceId: scope.workspaceId,
      conversationId: input.conversationId,
      botId: input.botId,
      status: "open",
      botInstructionsVersion: bot.instructionsVersion,
      openedAt: input.now,
    })
    .returning()
    .get();
}

export function getSession(db: Db, scope: WorkspaceScope, id: string): Session | undefined {
  return db
    .select()
    .from(sessions)
    .where(and(inWorkspace(sessions, scope), eq(sessions.id, id)))
    .get();
}

export function listSessions(db: Db, scope: WorkspaceScope, conversationId: string): Session[] {
  return db
    .select()
    .from(sessions)
    .where(and(inWorkspace(sessions, scope), eq(sessions.conversationId, conversationId)))
    .orderBy(asc(sessions.id))
    .all();
}

export type ClosedSessions = { closed: Session[]; cancelledRunning: string[] };

function closeSession(
  db: Db,
  scope: WorkspaceScope,
  open: Session,
  reason: SessionCloseReason,
  now: Date,
): { closed: Session; cancelledRunning: string[] } {
  const cancelledRunning = cancelSessionRuns(db, scope, open.id, now);
  const closed = db
    .update(sessions)
    .set({ status: "closed", closedAt: now, closedBy: reason })
    .where(and(inWorkspace(sessions, scope), eq(sessions.id, open.id)))
    .returning()
    .get();
  appendEvent(db, scope, {
    conversationId: closed.conversationId,
    event: { kind: "session_closed", session: toSessionItem(closed) },
    now,
  });
  return { closed, cancelledRunning };
}

export function resetSession(
  db: Db,
  scope: WorkspaceScope,
  input: { conversationId: string; now: Date },
): { closed: Session | undefined; cancelledRunning: string[] } | undefined {
  return db.transaction((tx) => {
    const conversation = getConversation(tx, scope, input.conversationId);
    if (!conversation) return undefined;
    const open = openSessionOf(tx, scope, conversation.id, conversation.primaryBotId);
    if (!open) return { closed: undefined, cancelledRunning: [] };
    return closeSession(tx, scope, open, "reset", input.now);
  });
}

/** Closing the Bot's open Sessions in the same transaction means no Run goes on with the old instructions. */
export function updateBotSettings(
  db: Db,
  scope: WorkspaceScope,
  botId: string,
  input: BotPatch & { instructions?: string; now: Date },
): ({ bot: Bot; instructionsChanged: boolean } & ClosedSessions) | undefined {
  return db.transaction((tx) => {
    const { instructions, now, ...patch } = input;
    let bot = getBot(tx, scope, botId);
    if (!bot) return undefined;
    if (Object.keys(patch).length > 0) bot = updateBot(tx, scope, botId, patch)!;
    const replaced =
      instructions === undefined ? undefined : replaceBotInstructions(tx, scope, botId, instructions)!;
    if (!replaced?.changed) return { bot, instructionsChanged: false, closed: [], cancelledRunning: [] };
    const open = tx
      .select()
      .from(sessions)
      .where(and(inWorkspace(sessions, scope), eq(sessions.botId, botId), eq(sessions.status, "open")))
      .orderBy(asc(sessions.id))
      .all();
    const result: ClosedSessions = { closed: [], cancelledRunning: [] };
    for (const session of open) {
      const { closed, cancelledRunning } = closeSession(tx, scope, session, "instructions_changed", now);
      result.closed.push(closed);
      result.cancelledRunning.push(...cancelledRunning);
    }
    return { bot: replaced.bot, instructionsChanged: true, ...result };
  });
}
