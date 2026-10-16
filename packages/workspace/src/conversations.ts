import type { Db } from "@momo/migrator";
import { and, asc, desc, eq, lt } from "drizzle-orm";
import { getBot } from "./bots.ts";
import { decodeCursor, pageLimit, toPage, type Page } from "./paging.ts";
import { inTenant } from "./scoped.ts";
import { conversationParticipants, conversations, type ParticipantRole } from "./schema.ts";
import type { TenantContext } from "./tenant.ts";

export type ConversationSummary = {
  id: string;
  workspaceId: string;
  primaryBotId: string;
  createdAt: Date;
};

export type Participant = { botId: string; role: ParticipantRole };

export type Conversation = ConversationSummary & { participants: Participant[] };

const LIST = "conversations";

/** Starts a Conversation with a Bot of the same Workspace as its primary Bot. */
export function createConversation(
  db: Db,
  tenant: TenantContext,
  input: { primaryBotId: string; now: Date },
): Conversation | undefined {
  return db.transaction((tx) => {
    const bot = getBot(tx, tenant, input.primaryBotId);
    if (!bot) return undefined;
    const row = tx
      .insert(conversations)
      .values({
        id: `conversation_${Bun.randomUUIDv7()}`,
        workspaceId: tenant.workspaceId,
        createdAt: input.now,
      })
      .returning()
      .get();
    tx.insert(conversationParticipants)
      .values({
        id: `participant_${Bun.randomUUIDv7()}`,
        workspaceId: tenant.workspaceId,
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

function summaries(db: Db, tenant: TenantContext) {
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
        inTenant(conversationParticipants, tenant),
        eq(conversationParticipants.workspaceId, conversations.workspaceId),
        eq(conversationParticipants.conversationId, conversations.id),
        eq(conversationParticipants.role, "primary"),
      ),
    )
    .$dynamic();
}

export function getConversation(db: Db, tenant: TenantContext, id: string): Conversation | undefined {
  const summary = summaries(db, tenant)
    .where(and(inTenant(conversations, tenant), eq(conversations.id, id)))
    .get();
  if (!summary) return undefined;
  const participants = db
    .select({ botId: conversationParticipants.botId, role: conversationParticipants.role })
    .from(conversationParticipants)
    .where(and(inTenant(conversationParticipants, tenant), eq(conversationParticipants.conversationId, id)))
    .orderBy(asc(conversationParticipants.id))
    .all();
  return { ...summary, participants };
}

/** The Workspace's Conversations, newest first, as the conversation list shows them. */
export function listConversations(
  db: Db,
  tenant: TenantContext,
  options: { cursor?: string; limit?: number },
): Page<ConversationSummary> {
  const limit = pageLimit(options.limit);
  const before = options.cursor === undefined ? undefined : decodeCursor(tenant, LIST, options.cursor);
  const rows = summaries(db, tenant)
    .where(
      and(inTenant(conversations, tenant), before === undefined ? undefined : lt(conversations.id, before)),
    )
    .orderBy(desc(conversations.id))
    .limit(limit + 1)
    .all();
  return toPage(tenant, LIST, rows, limit);
}
