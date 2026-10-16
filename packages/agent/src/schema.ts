import type { ConversationEvent, RunStatus } from "@momo/contracts";
import {
  conversationParticipants,
  conversations,
  sameWorkspaceParent,
  workspaceIdColumn,
  workspaceKey,
} from "@momo/workspace";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
  type SQLiteTableExtraConfigValue,
} from "drizzle-orm/sqlite-core";

type Constraints = SQLiteTableExtraConfigValue[];

export type SessionStatus = "open" | "closed";

/** One Bot's model context in one Conversation. Its key is the Conversation and the Bot only (#8). */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    conversationId: text("conversation_id").notNull(),
    botId: text("bot_id").notNull(),
    status: text("status").$type<SessionStatus>().notNull(),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (t): Constraints => [
    workspaceKey(t),
    unique().on(t.workspaceId, t.conversationId, t.botId, t.id),
    uniqueIndex("sessions_one_open")
      .on(t.conversationId, t.botId)
      .where(sql`${t.status} = 'open'`),
    foreignKey({
      columns: [t.workspaceId, t.conversationId, t.botId],
      foreignColumns: [
        conversationParticipants.workspaceId,
        conversationParticipants.conversationId,
        conversationParticipants.botId,
      ],
    }),
  ],
);

export type ActorKind = "owner";

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    conversationId: text("conversation_id").notNull(),
    botId: text("bot_id").notNull(),
    sessionId: text("session_id").notNull(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorLoginId: text("actor_login_id").notNull(),
    inputMessageId: text("input_message_id").notNull(),
    status: text("status").$type<RunStatus>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t): Constraints => [
    workspaceKey(t),
    uniqueIndex("runs_one_running")
      .on(t.sessionId)
      .where(sql`${t.status} = 'running'`),
    index("runs_session_status").on(t.sessionId, t.status),
    foreignKey({
      columns: [t.workspaceId, t.conversationId, t.botId, t.sessionId],
      foreignColumns: [sessions.workspaceId, sessions.conversationId, sessions.botId, sessions.id],
    }),
    sameWorkspaceParent(t, t.inputMessageId, messages),
  ],
);

export type AuthorKind = "owner" | "bot";

/** A public message of a Conversation; a Bot's message names the Run that wrote it. */
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    conversationId: text("conversation_id").notNull(),
    authorKind: text("author_kind").$type<AuthorKind>().notNull(),
    botId: text("bot_id"),
    runId: text("run_id"),
    text: text("text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t): Constraints => [
    workspaceKey(t),
    index("messages_conversation").on(t.workspaceId, t.conversationId, t.id),
    check(
      "messages_author",
      sql`(${t.authorKind} = 'owner' AND ${t.botId} IS NULL AND ${t.runId} IS NULL) OR (${t.authorKind} = 'bot' AND ${t.botId} IS NOT NULL AND ${t.runId} IS NOT NULL)`,
    ),
    sameWorkspaceParent(t, t.conversationId, conversations),
    sameWorkspaceParent(t, t.runId, runs),
    foreignKey({
      columns: [t.workspaceId, t.conversationId, t.botId],
      foreignColumns: [
        conversationParticipants.workspaceId,
        conversationParticipants.conversationId,
        conversationParticipants.botId,
      ],
    }),
  ],
);

/**
 * The Conversation's SSE event log. The integer id is the `Last-Event-ID`; AUTOINCREMENT keeps
 * ids from being reused, and SQLite's single writer makes commit order follow id order.
 */
export const conversationEvents = sqliteTable(
  "conversation_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workspaceId: workspaceIdColumn(),
    conversationId: text("conversation_id").notNull(),
    runId: text("run_id"),
    event: text("event", { mode: "json" }).$type<ConversationEvent>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t): Constraints => [
    workspaceKey(t),
    index("conversation_events_conversation").on(t.workspaceId, t.conversationId, t.id),
    sameWorkspaceParent(t, t.conversationId, conversations),
    sameWorkspaceParent(t, t.runId, runs),
  ],
);
