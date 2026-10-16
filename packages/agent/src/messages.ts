import type { MessageItem, RunStatus } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import {
  decodeCursor,
  getConversation,
  inWorkspace,
  pageLimit,
  toPage,
  type Page,
  type WorkspaceScope,
} from "@momo/workspace";
import { and, asc, eq, gt } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { attachmentsOf, toAttachmentItem, type Attachment } from "./attachments.ts";
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
  attachments: Attachment[];
  createdAt: Date;
};

const listName = (conversationId: string) => `messages:${conversationId}`;

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
    attachments: [],
    createdAt: row.createdAt,
  };
}

const answering = alias(runs, "answering");

/** Both joins are scoped like the messages. */
function selectMessages(db: Db, workspaceScope: WorkspaceScope) {
  return db
    .select({
      message: messages,
      writtenBy: { status: runs.status, sessionId: runs.sessionId },
      answeredBy: { status: answering.status, sessionId: answering.sessionId },
    })
    .from(messages)
    .leftJoin(
      runs,
      and(
        inWorkspace(runs, workspaceScope),
        eq(runs.workspaceId, messages.workspaceId),
        eq(runs.id, messages.runId),
      ),
    )
    .leftJoin(
      answering,
      and(
        inWorkspace(answering, workspaceScope),
        eq(answering.workspaceId, messages.workspaceId),
        eq(answering.inputMessageId, messages.id),
      ),
    );
}

function withAttachments(db: Db, workspaceScope: WorkspaceScope, list: Message[]): Message[] {
  const byMessage = attachmentsOf(
    db,
    workspaceScope,
    list.map((m) => m.id),
  );
  return list.map((m) => ({ ...m, attachments: byMessage.get(m.id) ?? [] }));
}

export function toMessageItem(message: Message): MessageItem {
  return {
    ...message,
    attachments: message.attachments.map(toAttachmentItem),
    createdAt: message.createdAt.getTime(),
  };
}

/** Callers check the Conversation, and the Bot's part in it, first. */
export function insertMessage(
  db: Db,
  workspaceScope: WorkspaceScope,
  input: { conversationId: string; author: MessageAuthor; sessionId: string; text: string; now: Date },
): Message {
  const bot = input.author.kind === "bot" ? input.author : undefined;
  const row = db
    .insert(messages)
    .values({
      id: `message_${Bun.randomUUIDv7()}`,
      workspaceId: workspaceScope.workspaceId,
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
    attachments: [],
    createdAt: row.createdAt,
  };
}

export function conversationMessages(
  db: Db,
  workspaceScope: WorkspaceScope,
  conversationId: string,
): Message[] {
  const list = selectMessages(db, workspaceScope)
    .where(and(inWorkspace(messages, workspaceScope), eq(messages.conversationId, conversationId)))
    .orderBy(asc(messages.id))
    .all()
    .map(toMessage);
  return withAttachments(db, workspaceScope, list);
}

export function listMessages(
  db: Db,
  workspaceScope: WorkspaceScope,
  conversationId: string,
  options: { cursor?: string; limit?: number },
): Page<Message> | undefined {
  const after =
    options.cursor === undefined
      ? undefined
      : decodeCursor(workspaceScope, listName(conversationId), options.cursor);
  if (!getConversation(db, workspaceScope, conversationId)) return undefined;
  const limit = pageLimit(options.limit);
  const list = selectMessages(db, workspaceScope)
    .where(
      and(
        inWorkspace(messages, workspaceScope),
        eq(messages.conversationId, conversationId),
        after === undefined ? undefined : gt(messages.id, after),
      ),
    )
    .orderBy(asc(messages.id))
    .limit(limit + 1)
    .all()
    .map(toMessage);
  const page = toPage(workspaceScope, listName(conversationId), list, limit);
  return { ...page, items: withAttachments(db, workspaceScope, page.items) };
}
