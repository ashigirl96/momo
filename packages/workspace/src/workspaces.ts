import { asc, eq } from "drizzle-orm";
import type { Db } from "@momo/migrator";
import { inWorkspace } from "./scoped.ts";
import { bots, conversations, workspaces } from "./schema.ts";
import type { WorkspaceScope } from "./workspace-scope.ts";

export type Workspace = typeof workspaces.$inferSelect;

export const WORKSPACE_NAME_MAX = 50;

export class InvalidWorkspaceName extends Error {
  override readonly name = "InvalidWorkspaceName";
}

export function createWorkspace(db: Db, input: { name: string; now: Date }): Workspace {
  const name = input.name.trim();
  if (name.length === 0 || name.length > WORKSPACE_NAME_MAX)
    throw new InvalidWorkspaceName(`name must be 1–${WORKSPACE_NAME_MAX} characters`);
  return db
    .insert(workspaces)
    .values({ id: `workspace_${Bun.randomUUIDv7()}`, name, createdAt: input.now })
    .returning()
    .get();
}

export function listWorkspaces(db: Db): Workspace[] {
  return db.select().from(workspaces).orderBy(asc(workspaces.id)).all();
}

export function findWorkspace(db: Db, id: string): Workspace | undefined {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

/** Other domains' rows of the Workspace must be deleted first in the same transaction. */
export function deleteWorkspace(db: Db, workspaceScope: WorkspaceScope): void {
  db.transaction((tx) => {
    tx.delete(conversations).where(inWorkspace(conversations, workspaceScope)).run();
    tx.delete(bots).where(inWorkspace(bots, workspaceScope)).run();
    tx.delete(workspaces).where(eq(workspaces.id, workspaceScope.workspaceId)).run();
  });
}
