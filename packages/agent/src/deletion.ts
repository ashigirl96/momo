import type { Db } from "@momo/migrator";
import { inWorkspace, type WorkspaceScope } from "@momo/workspace";
import { and, eq, inArray } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { attachments, conversationEvents, messages, runs, sessions } from "./schema.ts";

export type DeletedConversationRecords = {
  /** Their files are still on disk; remove them once the transaction has committed. */
  attachmentIds: string[];
  runningRunIds: string[];
};

/** Bot messages go before Runs and owner messages after them because they reference each other; Memory items must already be detached from the Runs. */
export function deleteConversationRecords(
  db: Db,
  workspaceScope: WorkspaceScope,
  conversationIds: string[],
): DeletedConversationRecords {
  if (conversationIds.length === 0) return { attachmentIds: [], runningRunIds: [] };
  const inConversations = (table: { workspaceId: AnySQLiteColumn; conversationId: AnySQLiteColumn }) =>
    and(inWorkspace(table, workspaceScope), inArray(table.conversationId, conversationIds));
  return db.transaction((tx) => {
    const attachmentIds = tx
      .delete(attachments)
      .where(
        and(
          inWorkspace(attachments, workspaceScope),
          inArray(
            attachments.messageId,
            tx.select({ id: messages.id }).from(messages).where(inConversations(messages)),
          ),
        ),
      )
      .returning({ id: attachments.id })
      .all()
      .map((row) => row.id);
    tx.delete(conversationEvents).where(inConversations(conversationEvents)).run();
    tx.delete(messages)
      .where(and(inConversations(messages), eq(messages.authorKind, "bot")))
      .run();
    const deletedRuns = tx
      .delete(runs)
      .where(inConversations(runs))
      .returning({ id: runs.id, status: runs.status })
      .all();
    tx.delete(messages).where(inConversations(messages)).run();
    tx.delete(sessions).where(inConversations(sessions)).run();
    return {
      attachmentIds,
      runningRunIds: deletedRuns.filter((run) => run.status === "running").map((run) => run.id),
    };
  });
}
