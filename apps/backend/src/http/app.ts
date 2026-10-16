import type { WebAsset } from "@momo/web/build";
import type { Server } from "bun";
import { handleApi, type ApiContext } from "./api.ts";
import { apiError } from "./respond.ts";
import { crossOriginRefusal, isSafeMethod, withSecurityHeaders } from "./security.ts";

export type AppContext = ApiContext & {
  host: () => string;
  origin: () => string;
  assets: Map<string, WebAsset>;
};

function serveAsset(req: Request, assets: Map<string, WebAsset>): Response {
  if (!isSafeMethod(req.method)) return apiError("method_not_allowed", "UI is read-only");
  const path = new URL(req.url).pathname;
  const asset = assets.get(path);
  if (asset) {
    return new Response(asset.body, {
      headers: { "content-type": asset.contentType, "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  if (/\.[a-z0-9]+$/i.test(path)) return new Response("not found", { status: 404 });
  const index = assets.get("/index.html")!;
  return new Response(index.body, {
    headers: { "content-type": index.contentType, "cache-control": "no-cache" },
  });
}

async function route(req: Request, server: Server<undefined>, ctx: AppContext): Promise<Response> {
  // A Host other than ours means DNS rebinding or a forged loopback request.
  if (req.headers.get("host") !== ctx.host()) return new Response("misdirected request", { status: 421 });
  if (req.method === "OPTIONS") return apiError("method_not_allowed", "no CORS");
  const path = new URL(req.url).pathname;
  if (path === "/api" || path.startsWith("/api/")) {
    const refusal = crossOriginRefusal(req, ctx.origin());
    if (refusal) return apiError("forbidden", refusal);
    return handleApi(req, server, ctx);
  }
  return serveAsset(req, ctx.assets);
}

export function createApp(ctx: AppContext) {
  return async (req: Request, server: Server<undefined>) =>
    withSecurityHeaders(await route(req, server, ctx));
}
