import type { BotModel, BotTool } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { and, desc, eq, lt } from "drizzle-orm";
import { decodeCursor, pageLimit, toPage, type Page } from "./paging.ts";
import { inTenant } from "./scoped.ts";
import { bots } from "./schema.ts";
import type { TenantContext } from "./tenant.ts";

export type Bot = typeof bots.$inferSelect;

export type BotSettings = { name: string; instructions: string; model: BotModel; tools: BotTool[] };

/** Instructions are left out: changing them closes the open Sessions. */
export type BotPatch = Partial<Pick<BotSettings, "name" | "model" | "tools">>;

const LIST = "bots";

export function createBot(db: Db, tenant: TenantContext, input: BotSettings & { now: Date }): Bot {
  return db
    .insert(bots)
    .values({
      id: `bot_${Bun.randomUUIDv7()}`,
      workspaceId: tenant.workspaceId,
      name: input.name,
      instructions: input.instructions,
      model: input.model,
      tools: input.tools,
      createdAt: input.now,
    })
    .returning()
    .get();
}

export function getBot(db: Db, tenant: TenantContext, id: string): Bot | undefined {
  return db
    .select()
    .from(bots)
    .where(and(inTenant(bots, tenant), eq(bots.id, id)))
    .get();
}

/** The Workspace's Bots, newest first, as the conversation list shows them. */
export function listBots(
  db: Db,
  tenant: TenantContext,
  options: { cursor?: string; limit?: number },
): Page<Bot> {
  const limit = pageLimit(options.limit);
  const before = options.cursor === undefined ? undefined : decodeCursor(tenant, LIST, options.cursor);
  const rows = db
    .select()
    .from(bots)
    .where(and(inTenant(bots, tenant), before === undefined ? undefined : lt(bots.id, before)))
    .orderBy(desc(bots.id))
    .limit(limit + 1)
    .all();
  return toPage(tenant, LIST, rows, limit);
}

export function updateBot(db: Db, tenant: TenantContext, id: string, patch: BotPatch): Bot | undefined {
  const set = { name: patch.name, model: patch.model, tools: patch.tools };
  return db
    .update(bots)
    .set(set)
    .where(and(inTenant(bots, tenant), eq(bots.id, id)))
    .returning()
    .get();
}
