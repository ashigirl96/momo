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
  type TenantContext,
} from "@momo/workspace";

export type Deletion = {
  conversationIds: string[];
  /** Runs app.db no longer has but the runner may still be working on. */
  runningRunIds: string[];
};

export function previewWorkspaceDeletion(db: Db, tenant: TenantContext): DeletionPreview {
  return { conversations: conversationIds(db, tenant).length };
}

export function previewBotDeletion(
  db: Db,
  tenant: TenantContext,
  botId: string,
): DeletionPreview | undefined {
  if (!getBot(db, tenant, botId)) return undefined;
  return { conversations: conversationIds(db, tenant, { primaryBotId: botId }).length };
}

/** Attachment files go only after the commit, so a failed transaction leaves both rows and files in place. */
export function deleteWorkspaceEverywhere(db: Db, files: AttachmentFiles, tenant: TenantContext): Deletion {
  const deletion = db.transaction((tx) => {
    const ids = conversationIds(tx, tenant);
    deleteWorkspaceMemory(tx, tenant);
    const { runningRunIds } = deleteConversationRecords(tx, tenant, ids);
    deleteWorkspace(tx, tenant);
    return { conversationIds: ids, runningRunIds };
  });
  removeWorkspaceAttachments(files, tenant);
  return deletion;
}

export function deleteBotEverywhere(
  db: Db,
  files: AttachmentFiles,
  tenant: TenantContext,
  botId: string,
): Deletion | undefined {
  const deletion = db.transaction((tx) => {
    if (!getBot(tx, tenant, botId)) return undefined;
    const ids = conversationIds(tx, tenant, { primaryBotId: botId });
    deleteBotMemory(tx, tenant, botId);
    for (const id of ids) detachMemoryFromConversation(tx, tenant, id);
    const records = deleteConversationRecords(tx, tenant, ids);
    deleteConversations(tx, tenant, ids);
    deleteBot(tx, tenant, botId);
    return { conversationIds: ids, ...records };
  });
  if (!deletion) return undefined;
  removeAttachmentFiles(files, tenant, deletion.attachmentIds);
  return { conversationIds: deletion.conversationIds, runningRunIds: deletion.runningRunIds };
}
