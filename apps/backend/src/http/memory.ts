import type { MemoryList } from "@momo/contracts";
import { deleteMemoryItem, getMemoryItem, listMemoryItems, toMemoryItem } from "@momo/memory";
import { getBot } from "@momo/workspace";
import { apiError, json, noContent } from "./respond.ts";
import { decode, listQuery, paged, type RouteContext } from "./route.ts";
import type { TenantRequest } from "./workspaces.ts";

const MEMORY = /^\/bots\/([^/]+)\/memory(?:\/([^/]+))?$/;

export function memoryRoute({ req, rest, tenant }: TenantRequest, ctx: RouteContext): Response | undefined {
  const match = MEMORY.exec(rest);
  if (!match) return undefined;
  const botId = decode(match[1]!);
  const bot = botId === undefined ? undefined : getBot(ctx.db, tenant, botId);
  if (!bot) return apiError("not_found", "no such Bot");

  if (match[2] === undefined) {
    if (req.method !== "GET") return undefined;
    return paged(() => {
      const page = listMemoryItems(ctx.db, tenant, bot.id, listQuery(req));
      return json({ items: page.items.map(toMemoryItem), nextCursor: page.nextCursor } satisfies MemoryList);
    });
  }

  const id = decode(match[2]);
  if (id === undefined) return apiError("not_found", "no such Memory item");
  if (req.method === "GET") {
    const item = getMemoryItem(ctx.db, tenant, bot.id, id);
    return item ? json(toMemoryItem(item)) : apiError("not_found", "no such Memory item");
  }
  if (req.method === "DELETE")
    return deleteMemoryItem(ctx.db, tenant, bot.id, id)
      ? noContent()
      : apiError("not_found", "no such Memory item");
  return undefined;
}
