import type { DeletionPreview } from "@momo/contracts";
import type { WorkspaceScope } from "@momo/workspace";
import {
  deleteBotEverywhere,
  deleteWorkspaceEverywhere,
  previewBotDeletion,
  previewWorkspaceDeletion,
  type Deletion,
} from "../deletion.ts";
import { apiError, json, noContent } from "./respond.ts";
import { decode, type RouteContext } from "./route.ts";
import type { WorkspaceScopedRequest } from "./workspaces.ts";

const BOT = /^\/bots\/([^/]+)(\/deletion-preview)?$/;

function settle(ctx: RouteContext, workspaceScope: WorkspaceScope, deletion: Deletion): Response {
  ctx.runs.stopCancelled(deletion.runningRunIds);
  for (const id of deletion.conversationIds) ctx.hub.notify(workspaceScope.workspaceId, id);
  return noContent();
}

export function deletionRoute(
  { req, rest, workspaceScope }: WorkspaceScopedRequest,
  ctx: RouteContext,
): Response | undefined {
  if (rest === "" && req.method === "DELETE")
    return settle(ctx, workspaceScope, deleteWorkspaceEverywhere(ctx.db, ctx.attachments, workspaceScope));
  if (rest === "/deletion-preview" && req.method === "GET")
    return json(previewWorkspaceDeletion(ctx.db, workspaceScope) satisfies DeletionPreview);

  const match = BOT.exec(rest);
  if (!match) return undefined;
  const botId = decode(match[1]!);
  const preview = match[2] !== undefined;
  if (preview ? req.method !== "GET" : req.method !== "DELETE") return undefined;
  if (botId === undefined) return apiError("not_found", "no such Bot");
  if (preview) {
    const found = previewBotDeletion(ctx.db, workspaceScope, botId);
    return found ? json(found satisfies DeletionPreview) : apiError("not_found", "no such Bot");
  }
  const deletion = deleteBotEverywhere(ctx.db, ctx.attachments, workspaceScope, botId);
  return deletion ? settle(ctx, workspaceScope, deletion) : apiError("not_found", "no such Bot");
}
