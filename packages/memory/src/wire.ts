import type { MemoryHit, MemoryItem } from "@momo/contracts";
import type { MemoryRecord, MemoryRow } from "./items.ts";

export function toMemoryHit(item: MemoryRow): MemoryHit {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description,
    tags: item.tags,
    ...(item.resource === null ? {} : { resource: item.resource }),
    body: item.body,
  };
}

export function toMemoryItem(item: MemoryRecord): MemoryItem {
  return {
    ...toMemoryHit(item),
    botId: item.botId,
    created: item.created,
    updated: item.updated,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
  };
}
