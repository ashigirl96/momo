import type { MemoryItem, MemoryList } from "@momo/contracts";
import { deleteMemoryItem, getMemoryItem, listMemoryItems, type MemoryRecord } from "@momo/memory";
import type { Db } from "@momo/migrator";
import { getBot, InvalidCursor } from "@momo/workspace";
import { apiError, json, noContent } from "./respond.ts";
import type { TenantRequest } from "./workspaces.ts";

type MemoryApiContext = { db: Db };

const MEMORY = /^\/bots\/([^/]+)\/memory(?:\/([^/]+))?$/;

export function toMemoryItem(item: MemoryRecord): MemoryItem {
  return {
    id: item.id,
    botId: item.botId,
    type: item.type,
    title: item.title,
    description: item.description,
    tags: item.tags,
    ...(item.resource === null ? {} : { resource: item.resource }),
    body: item.body,
    created: item.created,
    updated: item.updated,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  };
}

function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** Routes `/api/workspaces/:workspaceId/bots/:botId/memory…`; undefined means the path is not one of ours. */
export function memoryRoute(
  { req, rest, tenant }: TenantRequest,
  ctx: MemoryApiContext,
): Response | undefined {
  const match = MEMORY.exec(rest);
  if (!match) return undefined;
  const botId = decode(match[1]!);
  const bot = botId === undefined ? undefined : getBot(ctx.db, tenant, botId);
  if (!bot) return apiError("not_found", "no such Bot");

  if (match[2] === undefined) {
    if (req.method !== "GET") return undefined;
    const query = new URL(req.url).searchParams;
    const limit = query.has("limit") ? Number(query.get("limit")) : undefined;
    try {
      const page = listMemoryItems(ctx.db, tenant, bot.id, {
        cursor: query.get("cursor") ?? undefined,
        limit,
      });
      return json({ items: page.items.map(toMemoryItem), nextCursor: page.nextCursor } satisfies MemoryList);
    } catch (error) {
      if (error instanceof InvalidCursor) return apiError("bad_request", "invalid cursor");
      throw error;
    }
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
