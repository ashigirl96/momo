import { runs } from "@momo/agent";
import { bots, sameWorkspaceParent, workspaceIdColumn, workspaceKey } from "@momo/workspace";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type MemoryWriter = "bot" | "owner";

/**
 * A Bot's Memory item (ADR-0011). Edits and deletes happen in place, with no versions.
 * The full-text index `memory_fts` and the triggers that keep it in step are raw SQL in the
 * `fts` migration, because Drizzle does not model virtual tables.
 */
export const memoryItems = sqliteTable(
  "memory_items",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    botId: text("bot_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull(),
    resource: text("resource"),
    body: text("body").notNull(),
    createdBy: text("created_by").$type<MemoryWriter>().notNull(),
    /** Emptied when the Run's Conversation is deleted. */
    createdRunId: text("created_run_id"),
    updatedBy: text("updated_by").$type<MemoryWriter>().notNull(),
    /** Emptied when the Run's Conversation is deleted. */
    updatedRunId: text("updated_run_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    workspaceKey(t),
    index("memory_items_bot").on(t.workspaceId, t.botId, t.id),
    index("memory_items_created_run").on(t.workspaceId, t.createdRunId),
    index("memory_items_updated_run").on(t.workspaceId, t.updatedRunId),
    sameWorkspaceParent(t, t.botId, bots),
    sameWorkspaceParent(t, t.createdRunId, runs),
    sameWorkspaceParent(t, t.updatedRunId, runs),
  ],
);
