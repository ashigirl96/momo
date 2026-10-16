import {
  BotItem,
  BotList,
  BotSettingsProposal,
  ConversationItem,
  ConversationList,
  LoginList,
  MemoryList,
  MessagePage,
  PostMessageResponse,
  Status,
  WorkspaceItem,
  WorkspaceList,
  type CreateBotRequest,
  type CreateConversationRequest,
  type CreateWorkspaceRequest,
  type PairRequest,
  type PostMessageRequest,
  type ProposeBotRequest,
  type UpdateBotRequest,
} from "@momo/contracts";
import type { z } from "zod";

export class Unauthenticated extends Error {}
export class NotFound extends Error {}

async function request<T>(
  path: string,
  schema: z.ZodType<T> | undefined,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init.body ? { "content-type": "application/json" } : undefined,
  });
  if (res.status === 401) throw new Unauthenticated();
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed with ${res.status}`);
  return schema ? schema.parse(await res.json()) : (undefined as T);
}

const scoped = (workspaceId: string) => `/api/workspaces/${encodeURIComponent(workspaceId)}`;

export const api = {
  status: () => request("/api/status", Status),
  pair: (body: PairRequest) =>
    request("/api/pair", undefined, { method: "POST", body: JSON.stringify(body) }),
  logins: () => request("/api/logins", LoginList),
  revokeLogin: (id: string) =>
    request(`/api/logins/${encodeURIComponent(id)}`, undefined, { method: "DELETE" }),
  workspaces: () => request("/api/workspaces", WorkspaceList),
  workspace: (id: string) => request(`/api/workspaces/${encodeURIComponent(id)}`, WorkspaceItem),
  createWorkspace: (body: CreateWorkspaceRequest) =>
    request("/api/workspaces", WorkspaceItem, { method: "POST", body: JSON.stringify(body) }),
  bots: (workspaceId: string) => request(`${scoped(workspaceId)}/bots`, BotList),
  proposeBot: (workspaceId: string, body: ProposeBotRequest) =>
    request(`${scoped(workspaceId)}/bot-proposals`, BotSettingsProposal, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createBot: (workspaceId: string, body: CreateBotRequest) =>
    request(`${scoped(workspaceId)}/bots`, BotItem, { method: "POST", body: JSON.stringify(body) }),
  updateBot: (workspaceId: string, botId: string, body: UpdateBotRequest) =>
    request(`${scoped(workspaceId)}/bots/${encodeURIComponent(botId)}`, BotItem, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  conversations: (workspaceId: string) => request(`${scoped(workspaceId)}/conversations`, ConversationList),
  createConversation: (workspaceId: string, body: CreateConversationRequest) =>
    request(`${scoped(workspaceId)}/conversations`, ConversationItem, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  messages: (workspaceId: string, conversationId: string, cursor?: string) =>
    request(
      `${conversation(workspaceId, conversationId)}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      MessagePage,
    ),
  postMessage: (workspaceId: string, conversationId: string, body: PostMessageRequest) =>
    request(`${conversation(workspaceId, conversationId)}/messages`, PostMessageResponse, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  memory: (workspaceId: string, botId: string, cursor?: string) =>
    request(
      `${memory(workspaceId, botId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      MemoryList,
    ),
  deleteMemory: (workspaceId: string, botId: string, itemId: string) =>
    request(`${memory(workspaceId, botId)}/${encodeURIComponent(itemId)}`, undefined, { method: "DELETE" }),
  /** The browser resumes with `Last-Event-ID` on its own; `after` only sets the first connect. */
  conversationEvents: (workspaceId: string, conversationId: string, after: number) =>
    new EventSource(`${conversation(workspaceId, conversationId)}/events?after=${after}`),
};

function memory(workspaceId: string, botId: string) {
  return `${scoped(workspaceId)}/bots/${encodeURIComponent(botId)}/memory`;
}

function conversation(workspaceId: string, conversationId: string) {
  return `${scoped(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`;
}
