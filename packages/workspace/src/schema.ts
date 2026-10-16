import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const logins = sqliteTable("logins", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});
