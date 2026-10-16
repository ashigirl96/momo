import type { DeletionPreview } from "@momo/contracts";
import type { TenantContext } from "@momo/workspace";
import {
  deleteBotEverywhere,
  deleteWorkspaceEverywhere,
  previewBotDeletion,
  previewWorkspaceDeletion,
  type Deletion,
} from "../deletion.ts";
import { apiError, json, noContent } from "./respond.ts";
import { decode, type RouteContext } from "./route.ts";
import type { TenantRequest } from "./workspaces.ts";

const BOT = /^\/bots\/([^/]+)(\/deletion-preview)?$/;

/** Stops the runner on the deleted Runs and wakes the deleted Conversations' streams to close. */
function settle(ctx: RouteContext, tenant: TenantContext, deletion: Deletion): Response {
  ctx.runs.stopCancelled(deletion.runningRunIds);
  for (const id of deletion.conversationIds) ctx.hub.notify(tenant.workspaceId, id);
  return noContent();
}

/**
 * Routes `DELETE /api/workspaces/:id`, `DELETE …/bots/:botId` and their `GET …/deletion-preview`;
 * undefined means the path is not one of ours.
 */
export function deletionRoute({ req, rest, tenant }: TenantRequest, ctx: RouteContext): Response | undefined {
  if (rest === "" && req.method === "DELETE")
    return settle(ctx, tenant, deleteWorkspaceEverywhere(ctx.db, ctx.attachments, tenant));
  if (rest === "/deletion-preview" && req.method === "GET")
    return json(previewWorkspaceDeletion(ctx.db, tenant) satisfies DeletionPreview);

  const match = BOT.exec(rest);
  if (!match) return undefined;
  const botId = decode(match[1]!);
  const preview = match[2] !== undefined;
  if (preview ? req.method !== "GET" : req.method !== "DELETE") return undefined;
  if (botId === undefined) return apiError("not_found", "no such Bot");
  if (preview) {
    const found = previewBotDeletion(ctx.db, tenant, botId);
    return found ? json(found satisfies DeletionPreview) : apiError("not_found", "no such Bot");
  }
  const deletion = deleteBotEverywhere(ctx.db, ctx.attachments, tenant, botId);
  return deletion ? settle(ctx, tenant, deletion) : apiError("not_found", "no such Bot");
}
