import {
  CreateConversationRequest,
  type ConversationDetail,
  type ConversationItem,
  type ConversationList,
  type MessagePage,
  type PostMessageResponse,
  type ResetSessionResponse,
} from "@momo/contracts";
import {
  getAttachment,
  getRun,
  listMessages,
  listSessions,
  postOwnerMessage,
  resetSession,
  streamAfter,
  toMessageItem,
  toRunItem,
  toSessionItem,
  type AttachmentFiles,
} from "@momo/agent";
import type { Db } from "@momo/migrator";
import {
  createConversation,
  getConversation,
  InvalidCursor,
  listConversations,
  type ConversationSummary,
} from "@momo/workspace";
import type { ConversationHub } from "../conversation-hub.ts";
import type { RunLoop } from "../run-loop.ts";
import { attachmentResponse, readPostedMessage } from "./attachments.ts";
import { conversationEvents } from "./conversation-events.ts";
import { apiError, json } from "./respond.ts";
import type { TenantRequest } from "./workspaces.ts";

export type ConversationApiContext = {
  db: Db;
  now: () => Date;
  runs: RunLoop;
  hub: ConversationHub;
  attachments: AttachmentFiles;
  /** How often an open stream re-checks its Login and Workspace. */
  streamCheckMs: number;
};

const CONVERSATION = /^\/conversations\/([^/]+)(\/messages|\/events|\/reset)?$/;
const CONVERSATION_ATTACHMENT = /^\/conversations\/([^/]+)(\/attachments\/[^/]+)$/;
const RUN = /^\/runs\/([^/]+)(\/cancel)?$/;
const ATTACHMENT = /^\/attachments\/([^/]+)$/;

function toItem(c: ConversationSummary): ConversationItem {
  return { id: c.id, primaryBotId: c.primaryBotId, createdAt: c.createdAt.getTime() };
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

function listQuery(req: Request): { cursor?: string; limit?: number } {
  const query = new URL(req.url).searchParams;
  const cursor = query.get("cursor") ?? undefined;
  const limit = query.has("limit") ? Number(query.get("limit")) : undefined;
  return { cursor, limit };
}

function paged(read: () => Response): Response {
  try {
    return read();
  } catch (error) {
    if (error instanceof InvalidCursor) return apiError("bad_request", "invalid cursor");
    throw error;
  }
}

/** Routes `/api/workspaces/:workspaceId/{conversations,runs}…`; undefined means not one of ours. */
export async function conversationRoute(
  request: TenantRequest,
  ctx: ConversationApiContext,
): Promise<Response | undefined> {
  const { req, rest, tenant, body } = request;

  if (rest === "/conversations") {
    if (req.method === "GET")
      return paged(() => {
        const page = listConversations(ctx.db, tenant, listQuery(req));
        return json({
          conversations: page.items.map(toItem),
          nextCursor: page.nextCursor,
        } satisfies ConversationList);
      });
    if (req.method === "POST") {
      const input = CreateConversationRequest.safeParse(await body());
      if (!input.success) return apiError("bad_request", "expected { primaryBotId }");
      const conversation = createConversation(ctx.db, tenant, { ...input.data, now: ctx.now() });
      if (!conversation) return apiError("not_found", "no such Bot");
      return json(toItem(conversation), { status: 201 });
    }
    return undefined;
  }

  const run = RUN.exec(rest);
  if (run) {
    const id = decode(run[1]!);
    if (run[2] === undefined && req.method === "GET") {
      const found = id === undefined ? undefined : getRun(ctx.db, tenant, id);
      return found ? json(toRunItem(found)) : apiError("not_found", "no such Run");
    }
    if (run[2] === "/cancel" && req.method === "POST") {
      const cancelled = id === undefined ? undefined : ctx.runs.cancel(tenant, id);
      return cancelled ? json(toRunItem(cancelled)) : apiError("not_found", "no such Run");
    }
    return undefined;
  }

  const match = CONVERSATION.exec(rest) ?? CONVERSATION_ATTACHMENT.exec(rest);
  if (!match) return undefined;
  const id = decode(match[1]!);
  const conversation = id === undefined ? undefined : getConversation(ctx.db, tenant, id);
  if (!conversation) return apiError("not_found", "no such Conversation");
  const sub = match[2];

  const attachment = sub === undefined ? undefined : ATTACHMENT.exec(sub);
  if (attachment && req.method === "GET") {
    const attachmentId = decode(attachment[1]!);
    const found =
      attachmentId === undefined
        ? undefined
        : getAttachment(ctx.db, tenant, { conversationId: conversation.id, attachmentId });
    return found
      ? attachmentResponse(ctx.attachments, tenant, found)
      : apiError("not_found", "no such Attachment");
  }

  if (sub === undefined && req.method === "GET")
    return json({
      ...toItem(conversation),
      participants: conversation.participants,
    } satisfies ConversationDetail);

  if (sub === "/messages" && req.method === "GET")
    return paged(() => {
      const page = ctx.db.transaction((tx) => {
        const after = streamAfter(tx, tenant, conversation.id);
        const sessions = listSessions(tx, tenant, conversation.id);
        return { after, sessions, page: listMessages(tx, tenant, conversation.id, listQuery(req))! };
      });
      return json({
        messages: page.page.items.map(toMessageItem),
        nextCursor: page.page.nextCursor,
        sessions: page.sessions.map(toSessionItem),
        streamAfter: page.after,
      } satisfies MessagePage);
    });

  if (sub === "/reset" && req.method === "POST") {
    const reset = resetSession(ctx.db, tenant, { conversationId: conversation.id, now: ctx.now() });
    if (!reset) return apiError("not_found", "no such Conversation");
    ctx.runs.stopCancelled(reset.cancelledRunning);
    ctx.hub.notify(tenant.workspaceId, conversation.id);
    return json({
      closed: reset.closed && toSessionItem(reset.closed),
    } satisfies ResetSessionResponse);
  }

  if (sub === "/messages" && req.method === "POST") {
    const input = await readPostedMessage(req, body);
    if (input instanceof Response) return input;
    const posted = postOwnerMessage(ctx.db, tenant, {
      conversationId: conversation.id,
      text: input.text,
      now: ctx.now(),
      attachments: { files: ctx.attachments, uploads: input.uploads },
    });
    if (!posted) return apiError("not_found", "no such Conversation");
    ctx.hub.notify(tenant.workspaceId, conversation.id);
    ctx.runs.kick(tenant, posted.run.sessionId);
    return json(
      { message: toMessageItem(posted.message), run: toRunItem(posted.run) } satisfies PostMessageResponse,
      { status: 201 },
    );
  }

  if (sub === "/events" && req.method === "GET") return conversationEvents(request, conversation.id, ctx);
  return undefined;
}
