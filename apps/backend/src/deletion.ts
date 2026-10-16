import type { DeletionPreview } from "@momo/contracts";
import {
  deleteConversationRecords,
  removeAttachmentFiles,
  removeWorkspaceAttachments,
  type AttachmentFiles,
} from "@momo/agent";
import { deleteBotMemory, deleteWorkspaceMemory, detachMemoryFromConversation } from "@momo/memory";
import type { Db } from "@momo/migrator";
import {
  conversationIds,
  deleteBot,
  deleteConversations,
  deleteWorkspace,
  getBot,
  type WorkspaceScope,
} from "@momo/workspace";

export type Deletion = {
  conversationIds: string[];
  /** Runs app.db no longer has but the runner may still be working on. */
  runningRunIds: string[];
};

export function previewWorkspaceDeletion(db: Db, scope: WorkspaceScope): DeletionPreview {
  return { conversations: conversationIds(db, scope).length };
}

export function previewBotDeletion(
  db: Db,
  scope: WorkspaceScope,
  botId: string,
): DeletionPreview | undefined {
  if (!getBot(db, scope, botId)) return undefined;
  return { conversations: conversationIds(db, scope, { primaryBotId: botId }).length };
}

/** Attachment files go only after the commit, so a failed transaction leaves both rows and files in place. */
export function deleteWorkspaceEverywhere(db: Db, files: AttachmentFiles, scope: WorkspaceScope): Deletion {
  const deletion = db.transaction((tx) => {
    const ids = conversationIds(tx, scope);
    deleteWorkspaceMemory(tx, scope);
    const { runningRunIds } = deleteConversationRecords(tx, scope, ids);
    deleteWorkspace(tx, scope);
    return { conversationIds: ids, runningRunIds };
  });
  removeWorkspaceAttachments(files, scope);
  return deletion;
}

export function deleteBotEverywhere(
  db: Db,
  files: AttachmentFiles,
  scope: WorkspaceScope,
  botId: string,
): Deletion | undefined {
  const deletion = db.transaction((tx) => {
    if (!getBot(tx, scope, botId)) return undefined;
    const ids = conversationIds(tx, scope, { primaryBotId: botId });
    deleteBotMemory(tx, scope, botId);
    for (const id of ids) detachMemoryFromConversation(tx, scope, id);
    const records = deleteConversationRecords(tx, scope, ids);
    deleteConversations(tx, scope, ids);
    deleteBot(tx, scope, botId);
    return { conversationIds: ids, ...records };
  });
  if (!deletion) return undefined;
  removeAttachmentFiles(files, scope, deletion.attachmentIds);
  return { conversationIds: deletion.conversationIds, runningRunIds: deletion.runningRunIds };
}
