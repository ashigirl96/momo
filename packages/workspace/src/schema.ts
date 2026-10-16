import type { BotModel, BotTool } from "@momo/contracts";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { workspaceIdColumn, workspaceKey } from "./scoped.ts";

export const logins = sqliteTable("logins", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export { workspaces } from "./workspace-table.ts";

export const bots = sqliteTable(
  "bots",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    name: text("name").notNull(),
    instructions: text("instructions").notNull(),
    model: text("model").$type<BotModel>().notNull(),
    tools: text("tools", { mode: "json" }).$type<BotTool[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [workspaceKey(t)],
);
