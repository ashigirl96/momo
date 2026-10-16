import { PairRequest, type LoginItem, type LoginList, type Status, type Warning } from "@momo/contracts";
import { authenticateLogin, createLogin, listLogins, revokeLogin, type LoginSummary } from "@momo/workspace";
import type { Server } from "bun";
import type { PairingTokens } from "../pairing.ts";
import type { ConversationApiContext } from "./conversations.ts";
import { clearedLoginCookie, loginCookie, readLoginToken } from "./login-cookie.ts";
import { apiError, json, noContent } from "./respond.ts";
import { workspaceRoute } from "./workspaces.ts";

export type ApiContext = ConversationApiContext & {
  pairing: PairingTokens;
  warnings: Warning[];
};

type Authed = {
  req: Request;
  server: Server<undefined>;
  login: LoginSummary;
  path: string;
  stillLoggedIn: () => boolean;
};

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function toItem(login: LoginSummary, currentId: string): LoginItem {
  return {
    id: login.id,
    userAgent: login.userAgent,
    createdAt: login.createdAt.getTime(),
    lastUsedAt: login.lastUsedAt.getTime(),
    expiresAt: login.expiresAt.getTime(),
    current: login.id === currentId,
  };
}

async function pair(req: Request, ctx: ApiContext): Promise<Response> {
  const body = PairRequest.safeParse(await readJson(req));
  if (!body.success) return apiError("bad_request", "expected { token }");
  if (!ctx.pairing.consume(body.data.token)) {
    return apiError("unauthenticated", "pairing link is invalid or expired; run `momo open` again");
  }
  const { token } = createLogin(ctx.db, { userAgent: req.headers.get("user-agent") ?? "", now: ctx.now() });
  return noContent({ "set-cookie": loginCookie(token) });
}

async function authedRoute(
  { req, server, login, path, stillLoggedIn }: Authed,
  ctx: ApiContext,
): Promise<Response> {
  const workspace = await workspaceRoute(
    { req, server, path, login, stillLoggedIn, body: () => readJson(req) },
    ctx,
  );
  if (workspace) return workspace;
  if (path === "/api/status" && req.method === "GET") {
    return json({ loginId: login.id, warnings: ctx.warnings } satisfies Status);
  }
  if (path === "/api/logins" && req.method === "GET") {
    const logins = listLogins(ctx.db, ctx.now()).map((l) => toItem(l, login.id));
    return json({ logins } satisfies LoginList);
  }
  const revoke = /^\/api\/logins\/([^/]+)$/.exec(path);
  if (revoke && req.method === "DELETE") {
    const id = decodeURIComponent(revoke[1]!);
    if (!revokeLogin(ctx.db, id)) return apiError("not_found", "no such Login");
    return noContent(id === login.id ? { "set-cookie": clearedLoginCookie() } : undefined);
  }
  return apiError("not_found", "no such API");
}

export async function handleApi(req: Request, server: Server<undefined>, ctx: ApiContext): Promise<Response> {
  const path = new URL(req.url).pathname;
  if (path === "/api/pair" && req.method === "POST") return pair(req, ctx);

  const token = readLoginToken(req);
  const auth = authenticateLogin(ctx.db, token, ctx.now());
  if (!auth) return apiError("unauthenticated", "no Login; run `momo open`");
  const stillLoggedIn = () => authenticateLogin(ctx.db, token, ctx.now())?.login.id === auth.login.id;
  const res = await authedRoute({ req, server, login: auth.login, path, stillLoggedIn }, ctx);
  if (auth.renewed && !res.headers.has("set-cookie")) res.headers.set("set-cookie", loginCookie(token));
  return res;
}
