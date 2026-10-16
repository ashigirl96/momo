import { eventsAfter, streamAfter } from "@momo/agent";
import { getConversation, type TenantContext } from "@momo/workspace";
import type { RouteContext } from "./route.ts";
import { apiError } from "./respond.ts";
import type { TenantRequest } from "./workspaces.ts";

const encoder = new TextEncoder();

function parseEventId(value: string | null): number | undefined | "invalid" {
  if (value === null || value === "") return undefined;
  if (!/^\d{1,15}$/.test(value)) return "invalid";
  return Number(value);
}

/** Re-checks the Login and Workspace before every batch and every `streamCheckMs`, so a revoked Login or deleted Workspace gets nothing more. */
export function conversationEvents(
  { req, server, tenant, reauthorize }: TenantRequest,
  conversationId: string,
  ctx: RouteContext,
): Response {
  const resumed = parseEventId(req.headers.get("last-event-id"));
  const first = parseEventId(new URL(req.url).searchParams.get("after"));
  if (resumed === "invalid" || first === "invalid") return apiError("bad_request", "invalid event id");
  let last = resumed ?? first ?? streamAfter(ctx.db, tenant, conversationId);

  // Bun's 10 s idle timeout would otherwise cut a quiet stream.
  server.timeout(req, 0);
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        cleanup?.();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };
      const authorized = (): TenantContext | undefined => {
        const again = reauthorize();
        if (!again || !getConversation(ctx.db, again, conversationId)) return undefined;
        return again;
      };
      const flush = () => {
        if (!open) return;
        const scope = authorized();
        if (!scope) return close();
        for (;;) {
          const batch = eventsAfter(ctx.db, scope, conversationId, last);
          if (batch.length === 0) return;
          for (const { id, event } of batch) {
            controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`));
            last = id;
          }
        }
      };
      const check = () => {
        if (!authorized()) return close();
        controller.enqueue(encoder.encode(": ok\n\n"));
      };
      const unsubscribe = ctx.hub.subscribe(tenant, conversationId, flush, close);
      const timer = setInterval(check, ctx.streamCheckMs);
      cleanup = () => {
        clearInterval(timer);
        unsubscribe();
      };
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      flush();
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
  });
}
