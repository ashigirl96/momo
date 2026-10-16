import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sameWorkspaceParent, workspaceIdColumn, workspaceKey } from "../src/scoped.ts";

export const fixtureFolders = sqliteTable(
  "fixture_folders",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    name: text("name").notNull(),
  },
  (t) => [workspaceKey(t)],
);

export const fixtureNotes = sqliteTable(
  "fixture_notes",
  {
    id: text("id").primaryKey(),
    workspaceId: workspaceIdColumn(),
    folderId: text("folder_id").notNull(),
    body: text("body").notNull(),
  },
  (t) => [workspaceKey(t), sameWorkspaceParent(t, t.folderId, fixtureFolders)],
);
