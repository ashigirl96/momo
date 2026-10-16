import type { MessageItem } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import {
  decodeCursor,
  getConversation,
  inTenant,
  pageLimit,
  toPage,
  type Page,
  type TenantContext,
} from "@momo/workspace";
import { and, asc, eq, gt } from "drizzle-orm";
import { messages } from "./schema.ts";

type MessageRow = typeof messages.$inferSelect;

export type MessageAuthor = { kind: "owner" } | { kind: "bot"; botId: string; runId: string };

export type Message = {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  text: string;
  createdAt: Date;
};

const LIST = "messages";

function toMessage(row: MessageRow): Message {
  const author: MessageAuthor =
    row.authorKind === "bot" ? { kind: "bot", botId: row.botId!, runId: row.runId! } : { kind: "owner" };
  return { id: row.id, conversationId: row.conversationId, author, text: row.text, createdAt: row.createdAt };
}

export function toMessageItem(message: Message): MessageItem {
  return { ...message, createdAt: message.createdAt.getTime() };
}

/** Inserts a public message; callers check the Conversation (and the Bot's part in it) first. */
export function insertMessage(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; author: MessageAuthor; text: string; now: Date },
): Message {
  const bot = input.author.kind === "bot" ? input.author : undefined;
  const row = db
    .insert(messages)
    .values({
      id: `message_${Bun.randomUUIDv7()}`,
      workspaceId: tenant.workspaceId,
      conversationId: input.conversationId,
      authorKind: input.author.kind,
      botId: bot?.botId,
      runId: bot?.runId,
      text: input.text,
      createdAt: input.now,
    })
    .returning()
    .get();
  return toMessage(row);
}

/** All public messages of the Conversation, oldest first, for a Run's input. */
export function conversationMessages(db: Db, tenant: TenantContext, conversationId: string): Message[] {
  return db
    .select()
    .from(messages)
    .where(and(inTenant(messages, tenant), eq(messages.conversationId, conversationId)))
    .orderBy(asc(messages.id))
    .all()
    .map(toMessage);
}

/** The Conversation's history, oldest first; undefined when the Conversation is not the tenant's. */
export function listMessages(
  db: Db,
  tenant: TenantContext,
  conversationId: string,
  options: { cursor?: string; limit?: number },
): Page<Message> | undefined {
  const after = options.cursor === undefined ? undefined : decodeCursor(tenant, LIST, options.cursor);
  if (!getConversation(db, tenant, conversationId)) return undefined;
  const limit = pageLimit(options.limit);
  const rows = db
    .select()
    .from(messages)
    .where(
      and(
        inTenant(messages, tenant),
        eq(messages.conversationId, conversationId),
        after === undefined ? undefined : gt(messages.id, after),
      ),
    )
    .orderBy(asc(messages.id))
    .limit(limit + 1)
    .all()
    .map(toMessage);
  return toPage(tenant, LIST, rows, limit);
}
