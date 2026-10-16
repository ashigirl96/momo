import type { BotModel, BotTool } from "@momo/contracts";
import { sql } from "drizzle-orm";
import { foreignKey, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sameWorkspaceParent, workspaceIdColumn, workspaceKey } from "./scoped.ts";

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
    /** Grows by one each time the instructions change; a Session records the one it ran with (#8). */
    instructionsVersion: integer("instructions_version").notNull().default(1),
    model: text("model").$type<BotModel>().notNull(),
    tools: text("tools", { mode: "json" }).$type<BotTool[]>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [workspaceKey(t)],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [workspaceKey(t)],
);

export type ParticipantRole = "primary" | "member";

/** The Bots taking part in a Conversation. P2 has only the primary Bot; P7 adds members. */
export const conversationParticipants = sqliteTable(
  "conversation_participants",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    conversationId: text("conversation_id").notNull(),
    botId: text("bot_id").notNull(),
    role: text("role").$type<ParticipantRole>().notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    workspaceKey(t),
    unique().on(t.workspaceId, t.conversationId, t.botId),
    uniqueIndex("conversation_participants_one_primary")
      .on(t.conversationId)
      .where(sql`${t.role} = 'primary'`),
    foreignKey({
      columns: [t.workspaceId, t.conversationId],
      foreignColumns: [conversations.workspaceId, conversations.id],
    }).onDelete("cascade"),
    sameWorkspaceParent(t, t.botId, bots),
  ],
);
