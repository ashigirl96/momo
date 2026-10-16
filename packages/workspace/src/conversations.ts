import type { Db } from "@momo/migrator";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { getBot } from "./bots.ts";
import { decodeCursor, pageLimit, toPage, type Page } from "./paging.ts";
import { inWorkspace } from "./scoped.ts";
import { conversationParticipants, conversations, type ParticipantRole } from "./schema.ts";
import type { WorkspaceScope } from "./workspace-scope.ts";

export type ConversationSummary = {
  id: string;
  workspaceId: string;
  primaryBotId: string;
  createdAt: Date;
};

export type Participant = { botId: string; role: ParticipantRole };

export type Conversation = ConversationSummary & { participants: Participant[] };

const LIST = "conversations";

export function createConversation(
  db: Db,
  scope: WorkspaceScope,
  input: { primaryBotId: string; now: Date },
): Conversation | undefined {
  return db.transaction((tx) => {
    const bot = getBot(tx, scope, input.primaryBotId);
    if (!bot) return undefined;
    const row = tx
      .insert(conversations)
      .values({
        id: `conversation_${Bun.randomUUIDv7()}`,
        workspaceId: scope.workspaceId,
        createdAt: input.now,
      })
      .returning()
      .get();
    tx.insert(conversationParticipants)
      .values({
        id: `participant_${Bun.randomUUIDv7()}`,
        workspaceId: scope.workspaceId,
        conversationId: row.id,
        botId: bot.id,
        role: "primary",
        joinedAt: input.now,
      })
      .run();
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      primaryBotId: bot.id,
      participants: [{ botId: bot.id, role: "primary" }],
      createdAt: row.createdAt,
    };
  });
}

function summaries(db: Db, scope: WorkspaceScope) {
  return db
    .select({
      id: conversations.id,
      workspaceId: conversations.workspaceId,
      primaryBotId: conversationParticipants.botId,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .innerJoin(
      conversationParticipants,
      and(
        inWorkspace(conversationParticipants, scope),
        eq(conversationParticipants.workspaceId, conversations.workspaceId),
        eq(conversationParticipants.conversationId, conversations.id),
        eq(conversationParticipants.role, "primary"),
      ),
    )
    .$dynamic();
}

export function getConversation(db: Db, scope: WorkspaceScope, id: string): Conversation | undefined {
  const summary = summaries(db, scope)
    .where(and(inWorkspace(conversations, scope), eq(conversations.id, id)))
    .get();
  if (!summary) return undefined;
  const participants = db
    .select({ botId: conversationParticipants.botId, role: conversationParticipants.role })
    .from(conversationParticipants)
    .where(and(inWorkspace(conversationParticipants, scope), eq(conversationParticipants.conversationId, id)))
    .orderBy(asc(conversationParticipants.id))
    .all();
  return { ...summary, participants };
}

export function listConversations(
  db: Db,
  scope: WorkspaceScope,
  options: { cursor?: string; limit?: number },
): Page<ConversationSummary> {
  const limit = pageLimit(options.limit);
  const before = options.cursor === undefined ? undefined : decodeCursor(scope, LIST, options.cursor);
  const rows = summaries(db, scope)
    .where(
      and(inWorkspace(conversations, scope), before === undefined ? undefined : lt(conversations.id, before)),
    )
    .orderBy(desc(conversations.id))
    .limit(limit + 1)
    .all();
  return toPage(scope, LIST, rows, limit);
}

export function conversationIds(
  db: Db,
  scope: WorkspaceScope,
  filter: { primaryBotId?: string } = {},
): string[] {
  const query = summaries(db, scope);
  const rows = (
    filter.primaryBotId === undefined
      ? query.where(inWorkspace(conversations, scope))
      : query.where(
          and(inWorkspace(conversations, scope), eq(conversationParticipants.botId, filter.primaryBotId)),
        )
  ).all();
  return rows.map((row) => row.id);
}

/** Other domains' rows that reference them must go first; their foreign keys refuse otherwise. */
export function deleteConversations(db: Db, scope: WorkspaceScope, ids: string[]): number {
  if (ids.length === 0) return 0;
  return db
    .delete(conversations)
    .where(and(inWorkspace(conversations, scope), inArray(conversations.id, ids)))
    .returning({ id: conversations.id })
    .all().length;
}
