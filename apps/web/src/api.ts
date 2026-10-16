import {
  BotItem,
  BotList,
  BotSettingsProposal,
  LoginList,
  Status,
  WorkspaceItem,
  WorkspaceList,
  type CreateBotRequest,
  type CreateWorkspaceRequest,
  type PairRequest,
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
};
