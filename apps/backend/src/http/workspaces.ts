import { CreateWorkspaceRequest, type WorkspaceItem, type WorkspaceList } from "@momo/contracts";
import {
  createWorkspace,
  listWorkspaces,
  resolveTenant,
  type LoginSummary,
  type TenantContext,
  type Workspace,
} from "@momo/workspace";
import type { Server } from "bun";
import { botRoute } from "./bots.ts";
import { conversationRoute } from "./conversations.ts";
import { deletionRoute } from "./deletion.ts";
import { memoryRoute } from "./memory.ts";
import { apiError, json } from "./respond.ts";
import { decode, type RouteContext } from "./route.ts";

type AuthedRequest = {
  req: Request;
  server: Server<undefined>;
  path: string;
  login: LoginSummary;
  stillLoggedIn: () => boolean;
  body: () => Promise<unknown>;
};

/** A request under `/api/workspaces/:workspaceId`, with the Workspace resolved on the trusted side. */
export type TenantRequest = {
  req: Request;
  server: Server<undefined>;
  rest: string;
  tenant: TenantContext;
  /** Resolves the Login and the Workspace again, for a long-lived stream to re-check its access. */
  reauthorize: () => TenantContext | undefined;
  body: () => Promise<unknown>;
};

const SCOPED = /^\/api\/workspaces\/([^/]+)(\/.*)?$/;

function toWorkspaceItem(workspace: Workspace): WorkspaceItem {
  return { id: workspace.id, name: workspace.name, createdAt: workspace.createdAt.getTime() };
}

export async function workspaceRoute(
  { req, server, path, login, stillLoggedIn, body }: AuthedRequest,
  ctx: RouteContext,
): Promise<Response | undefined> {
  if (path === "/api/workspaces") {
    if (req.method === "GET")
      return json({ workspaces: listWorkspaces(ctx.db).map(toWorkspaceItem) } satisfies WorkspaceList);
    if (req.method === "POST") {
      const input = CreateWorkspaceRequest.safeParse(await body());
      if (!input.success) return apiError("bad_request", "expected { name } of 1–50 characters");
      return json(toWorkspaceItem(createWorkspace(ctx.db, { name: input.data.name, now: ctx.now() })), {
        status: 201,
      });
    }
    return undefined;
  }

  const scoped = SCOPED.exec(path);
  if (!scoped) return undefined;
  const query = new URL(req.url).searchParams;
  if (query.has("workspaceId") || query.has("workspace_id"))
    return apiError("bad_request", "the Workspace is named by the path only");
  const id = decode(scoped[1]!);
  const resolve = () =>
    id === undefined ? undefined : resolveTenant(ctx.db, id, { kind: "owner", loginId: login.id });
  const tenant = resolve();
  if (!tenant) return apiError("not_found", "no such Workspace");
  const reauthorize = () => (stillLoggedIn() ? resolve() : undefined);
  return tenantRoute({ req, server, rest: scoped[2] ?? "", tenant, reauthorize, body }, ctx);
}

async function tenantRoute(request: TenantRequest, ctx: RouteContext): Promise<Response | undefined> {
  if (request.rest === "" && request.req.method === "GET")
    return json(toWorkspaceItem(request.tenant.workspace));
  return (
    (await conversationRoute(request, ctx)) ??
    memoryRoute(request, ctx) ??
    deletionRoute(request, ctx) ??
    botRoute(request, ctx)
  );
}
