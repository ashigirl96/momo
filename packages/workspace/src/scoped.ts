import { eq, type SQL } from "drizzle-orm";
import { foreignKey, text, unique, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { workspaces } from "./workspace-table.ts";
import type { WorkspaceScope } from "./workspace-scope.ts";

type WorkspaceOwned = { workspaceId: AnySQLiteColumn; id: AnySQLiteColumn };

/** Each table's migration adds the trigger that refuses to change it. */
export const workspaceIdColumn = () =>
  text("workspace_id")
    .notNull()
    .references(() => workspaces.id);

/** Makes `(workspace_id, id)` a key children of the same Workspace can reference. */
export const workspaceKey = (table: WorkspaceOwned) => unique().on(table.workspaceId, table.id);

/** References a parent by `(workspace_id, parent id)`, so the parent must be in the same Workspace. */
export const sameWorkspaceParent = (
  table: { workspaceId: AnySQLiteColumn },
  parentId: AnySQLiteColumn,
  parent: WorkspaceOwned,
) => foreignKey({ columns: [table.workspaceId, parentId], foreignColumns: [parent.workspaceId, parent.id] });

/** The Workspace condition every read, update, delete and JOIN of a Workspace-owned table carries. */
export const inWorkspace = (table: { workspaceId: AnySQLiteColumn }, workspaceScope: WorkspaceScope): SQL =>
  eq(table.workspaceId, workspaceScope.workspaceId);
