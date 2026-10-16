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

export function previewWorkspaceDeletion(db: Db, workspaceScope: WorkspaceScope): DeletionPreview {
  return { conversations: conversationIds(db, workspaceScope).length };
}

export function previewBotDeletion(
  db: Db,
  workspaceScope: WorkspaceScope,
  botId: string,
): DeletionPreview | undefined {
  if (!getBot(db, workspaceScope, botId)) return undefined;
  return { conversations: conversationIds(db, workspaceScope, { primaryBotId: botId }).length };
}

/** Attachment files go only after the commit, so a failed transaction leaves both rows and files in place. */
export function deleteWorkspaceEverywhere(
  db: Db,
  files: AttachmentFiles,
  workspaceScope: WorkspaceScope,
): Deletion {
  const deletion = db.transaction((tx) => {
    const ids = conversationIds(tx, workspaceScope);
    deleteWorkspaceMemory(tx, workspaceScope);
    const { runningRunIds } = deleteConversationRecords(tx, workspaceScope, ids);
    deleteWorkspace(tx, workspaceScope);
    return { conversationIds: ids, runningRunIds };
  });
  removeWorkspaceAttachments(files, workspaceScope);
  return deletion;
}

export function deleteBotEverywhere(
  db: Db,
  files: AttachmentFiles,
  workspaceScope: WorkspaceScope,
  botId: string,
): Deletion | undefined {
  const deletion = db.transaction((tx) => {
    if (!getBot(tx, workspaceScope, botId)) return undefined;
    const ids = conversationIds(tx, workspaceScope, { primaryBotId: botId });
    deleteBotMemory(tx, workspaceScope, botId);
    for (const id of ids) detachMemoryFromConversation(tx, workspaceScope, id);
    const records = deleteConversationRecords(tx, workspaceScope, ids);
    deleteConversations(tx, workspaceScope, ids);
    deleteBot(tx, workspaceScope, botId);
    return { conversationIds: ids, ...records };
  });
  if (!deletion) return undefined;
  removeAttachmentFiles(files, workspaceScope, deletion.attachmentIds);
  return { conversationIds: deletion.conversationIds, runningRunIds: deletion.runningRunIds };
}
