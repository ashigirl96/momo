import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Kept apart from schema.ts so the column helpers in scoped.ts can reference it without an import cycle. */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});
