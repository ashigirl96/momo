import type { BotModel, BotTool } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { decodeCursor, pageLimit, toPage, type Page } from "./paging.ts";
import { inWorkspace } from "./scoped.ts";
import { bots } from "./schema.ts";
import type { WorkspaceScope } from "./workspace-scope.ts";

export type Bot = typeof bots.$inferSelect;

export type BotSettings = { name: string; instructions: string; model: BotModel; tools: BotTool[] };

/** Instructions are left out: changing them closes the open Sessions. */
export type BotPatch = Partial<Pick<BotSettings, "name" | "model" | "tools">>;

const LIST = "bots";

export function createBot(db: Db, workspaceScope: WorkspaceScope, input: BotSettings & { now: Date }): Bot {
  return db
    .insert(bots)
    .values({
      id: `bot_${Bun.randomUUIDv7()}`,
      workspaceId: workspaceScope.workspaceId,
      name: input.name,
      instructions: input.instructions,
      model: input.model,
      tools: input.tools,
      createdAt: input.now,
    })
    .returning()
    .get();
}

export function getBot(db: Db, workspaceScope: WorkspaceScope, id: string): Bot | undefined {
  return db
    .select()
    .from(bots)
    .where(and(inWorkspace(bots, workspaceScope), eq(bots.id, id)))
    .get();
}

export function listBots(
  db: Db,
  workspaceScope: WorkspaceScope,
  options: { cursor?: string; limit?: number },
): Page<Bot> {
  const limit = pageLimit(options.limit);
  const before =
    options.cursor === undefined ? undefined : decodeCursor(workspaceScope, LIST, options.cursor);
  const rows = db
    .select()
    .from(bots)
    .where(and(inWorkspace(bots, workspaceScope), before === undefined ? undefined : lt(bots.id, before)))
    .orderBy(desc(bots.id))
    .limit(limit + 1)
    .all();
  return toPage(workspaceScope, LIST, rows, limit);
}

/** Callers go through agent's `updateBotSettings`, which closes the Bot's open Sessions in the same transaction. */
export function replaceBotInstructions(
  db: Db,
  workspaceScope: WorkspaceScope,
  id: string,
  instructions: string,
): { bot: Bot; changed: boolean } | undefined {
  const bot = getBot(db, workspaceScope, id);
  if (!bot || bot.instructions === instructions) return bot && { bot, changed: false };
  const updated = db
    .update(bots)
    .set({ instructions, instructionsVersion: sql`${bots.instructionsVersion} + 1` })
    .where(and(inWorkspace(bots, workspaceScope), eq(bots.id, id)))
    .returning()
    .get();
  return { bot: updated, changed: true };
}

export function updateBot(
  db: Db,
  workspaceScope: WorkspaceScope,
  id: string,
  patch: BotPatch,
): Bot | undefined {
  const set = { name: patch.name, model: patch.model, tools: patch.tools };
  return db
    .update(bots)
    .set(set)
    .where(and(inWorkspace(bots, workspaceScope), eq(bots.id, id)))
    .returning()
    .get();
}

/** Its Conversations and other domains' rows that reference it must go first. */
export function deleteBot(db: Db, workspaceScope: WorkspaceScope, id: string): boolean {
  return (
    db
      .delete(bots)
      .where(and(inWorkspace(bots, workspaceScope), eq(bots.id, id)))
      .returning({ id: bots.id })
      .all().length > 0
  );
}
