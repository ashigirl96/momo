import type { Db } from "@momo/migrator";
import { getConversation, type TenantContext } from "@momo/workspace";
import { appendEvent } from "./events.ts";
import { insertMessage, toMessageItem, type Message } from "./messages.ts";
import { queueRun, type Run } from "./runs.ts";
import { openSession } from "./sessions.ts";

/**
 * The owner speaks in a Conversation: the message, the primary Bot's Session and a queued Run are
 * written in one transaction, or nothing is when the Conversation is not the tenant's.
 */
export function postOwnerMessage(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; text: string; now: Date },
): { message: Message; run: Run } | undefined {
  return db.transaction((tx) => {
    const conversation = getConversation(tx, tenant, input.conversationId);
    if (!conversation) return undefined;
    const session = openSession(tx, tenant, {
      conversationId: conversation.id,
      botId: conversation.primaryBotId,
      now: input.now,
    });
    const message = insertMessage(tx, tenant, {
      conversationId: conversation.id,
      author: { kind: "owner" },
      sessionId: session.id,
      text: input.text,
      now: input.now,
    });
    appendEvent(tx, tenant, {
      conversationId: conversation.id,
      event: { kind: "message_created", message: toMessageItem(message) },
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
