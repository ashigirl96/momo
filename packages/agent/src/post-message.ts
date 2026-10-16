import type { Db } from "@momo/migrator";
import { getConversation, type TenantContext } from "@momo/workspace";
import { insertAttachments, type AttachmentFiles, type AttachmentUpload } from "./attachments.ts";
import { appendEvent } from "./events.ts";
import { insertMessage, toMessageItem, type Message } from "./messages.ts";
import { queueRun, type Run } from "./runs.ts";
import { openSession } from "./sessions.ts";

/**
 * The owner speaks in a Conversation: the message, its Attachments, the primary Bot's Session and
 * a queued Run are written in one transaction, or nothing is when the Conversation is not the
 * tenant's. Attachment files written before a failure are removed again.
 */
export function postOwnerMessage(
  db: Db,
  tenant: TenantContext,
  input: {
    conversationId: string;
    text: string;
    now: Date;
    attachments?: { files: AttachmentFiles; uploads: AttachmentUpload[] };
  },
): { message: Message; run: Run } | undefined {
  const written: string[] = [];
  try {
    return post(db, tenant, input, written);
  } catch (error) {
    for (const id of written) input.attachments!.files.remove(tenant, id);
    throw error;
  }
}

function post(
  db: Db,
  tenant: TenantContext,
  input: Parameters<typeof postOwnerMessage>[2],
  written: string[],
): { message: Message; run: Run } | undefined {
  return db.transaction((tx) => {
    const conversation = getConversation(tx, tenant, input.conversationId);
    if (!conversation) return undefined;
    const inserted = insertMessage(tx, tenant, {
      conversationId: conversation.id,
      author: { kind: "owner" },
      text: input.text,
      now: input.now,
    });
    const message: Message = {
      ...inserted,
      attachments: input.attachments
        ? insertAttachments(tx, tenant, {
            messageId: inserted.id,
            ...input.attachments,
            now: input.now,
            written,
          })
        : [],
    };
    appendEvent(tx, tenant, {
      conversationId: conversation.id,
      event: { kind: "message_created", message: toMessageItem(message) },
      now: input.now,
    });
    const session = openSession(tx, tenant, {
      conversationId: conversation.id,
      botId: conversation.primaryBotId,
      now: input.now,
    });
    const run = queueRun(tx, tenant, {
      conversationId: conversation.id,
      botId: conversation.primaryBotId,
      sessionId: session.id,
      inputMessageId: message.id,
      now: input.now,
    });
    return { message, run };
  });
}
