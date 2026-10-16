import type { MessageItem, RunStatus } from "@momo/contracts";
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
import { alias } from "drizzle-orm/sqlite-core";
import { messages, runs } from "./schema.ts";

type MessageRow = typeof messages.$inferSelect;

/** A Bot's message is `cancelled` when the owner stopped its Run part way through. */
export type MessageAuthor =
  | { kind: "owner" }
  | { kind: "bot"; botId: string; runId: string; cancelled: boolean };

export type Message = {
  id: string;
  conversationId: string;
  author: MessageAuthor;
  sessionId: string;
  text: string;
  createdAt: Date;
};

const LIST = "messages";

type RunRef = { status: RunStatus; sessionId: string } | null;

type JoinedRow = { message: MessageRow; writtenBy: RunRef; answeredBy: RunRef };

function toMessage({ message: row, writtenBy, answeredBy }: JoinedRow): Message {
  const author: MessageAuthor =
    row.authorKind === "bot"
      ? { kind: "bot", botId: row.botId!, runId: row.runId!, cancelled: writtenBy?.status === "cancelled" }
      : { kind: "owner" };
  return {
    id: row.id,
    conversationId: row.conversationId,
    author,
    sessionId: (writtenBy ?? answeredBy)!.sessionId,
    text: row.text,
    createdAt: row.createdAt,
  };
}

const answering = alias(runs, "answering");

/**
 * The tenant's messages with the Run that wrote a Bot's message, or the Run that answers an owner's
 * message; that Run names the Session. Both joins are scoped like the messages.
 */
function selectMessages(db: Db, tenant: TenantContext) {
  return db
    .select({
      message: messages,
      writtenBy: { status: runs.status, sessionId: runs.sessionId },
      answeredBy: { status: answering.status, sessionId: answering.sessionId },
    })
    .from(messages)
    .leftJoin(
      runs,
      and(inTenant(runs, tenant), eq(runs.workspaceId, messages.workspaceId), eq(runs.id, messages.runId)),
    )
    .leftJoin(
      answering,
      and(
        inTenant(answering, tenant),
        eq(answering.workspaceId, messages.workspaceId),
        eq(answering.inputMessageId, messages.id),
      ),
    );
}

export function toMessageItem(message: Message): MessageItem {
  return { ...message, createdAt: message.createdAt.getTime() };
}

/** Inserts a public message; callers check the Conversation (and the Bot's part in it) first. */
export function insertMessage(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; author: MessageAuthor; sessionId: string; text: string; now: Date },
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
  return {
    id: row.id,
    conversationId: row.conversationId,
    author: input.author,
    sessionId: input.sessionId,
    text: row.text,
    createdAt: row.createdAt,
  };
}

/** All public messages of the Conversation, oldest first, for a Run's input. */
export function conversationMessages(db: Db, tenant: TenantContext, conversationId: string): Message[] {
  return selectMessages(db, tenant)
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
  const rows = selectMessages(db, tenant)
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
