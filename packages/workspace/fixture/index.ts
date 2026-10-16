/** A test-only domain that never reaches app.db; it is the template for a Workspace-owned table. */
import type { Db } from "@momo/migrator";
import { and, asc, eq, gt } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { decodeCursor, pageLimit, toPage, type Page } from "../src/paging.ts";
import { inWorkspace } from "../src/scoped.ts";
import type { WorkspaceScope } from "../src/workspace-scope.ts";
import { fixtureFolders, fixtureNotes } from "./schema.ts";

export const migrations = {
  domain: "fixture",
  dir: fileURLToPath(new URL("./migrations", import.meta.url)),
};

type Folder = typeof fixtureFolders.$inferSelect;
type Note = typeof fixtureNotes.$inferSelect;

export function createFolder(db: Db, scope: WorkspaceScope, input: { name: string }): Folder {
  return db
    .insert(fixtureFolders)
    .values({ id: `folder_${Bun.randomUUIDv7()}`, workspaceId: scope.workspaceId, name: input.name })
    .returning()
    .get();
}

export function createNote(
  db: Db,
  scope: WorkspaceScope,
  input: { folderId: string; body: string },
): Note | undefined {
  const folder = db
    .select({ id: fixtureFolders.id })
    .from(fixtureFolders)
    .where(and(inWorkspace(fixtureFolders, scope), eq(fixtureFolders.id, input.folderId)))
    .get();
  if (!folder) return undefined;
  return db
    .insert(fixtureNotes)
    .values({
      id: `note_${Bun.randomUUIDv7()}`,
      workspaceId: scope.workspaceId,
      folderId: folder.id,
      body: input.body,
    })
    .returning()
    .get();
}

export function getNote(db: Db, scope: WorkspaceScope, id: string): Note | undefined {
  return db
    .select()
    .from(fixtureNotes)
    .where(and(inWorkspace(fixtureNotes, scope), eq(fixtureNotes.id, id)))
    .get();
}

export function listNotes(
  db: Db,
  scope: WorkspaceScope,
  options: { cursor?: string; limit?: number },
): Page<Note> {
  const limit = pageLimit(options.limit);
  const after = options.cursor === undefined ? undefined : decodeCursor(scope, "notes", options.cursor);
  const rows = db
    .select()
    .from(fixtureNotes)
    .where(
      and(inWorkspace(fixtureNotes, scope), after === undefined ? undefined : gt(fixtureNotes.id, after)),
    )
    .orderBy(asc(fixtureNotes.id))
    .limit(limit + 1)
    .all();
  return toPage(scope, "notes", rows, limit);
}

export function listNotesWithFolder(db: Db, scope: WorkspaceScope): { body: string; folderName: string }[] {
  return db
    .select({ body: fixtureNotes.body, folderName: fixtureFolders.name })
    .from(fixtureNotes)
    .innerJoin(
      fixtureFolders,
      and(
        inWorkspace(fixtureFolders, scope),
        eq(fixtureFolders.workspaceId, fixtureNotes.workspaceId),
        eq(fixtureFolders.id, fixtureNotes.folderId),
      ),
    )
    .where(inWorkspace(fixtureNotes, scope))
    .orderBy(asc(fixtureNotes.id))
    .all();
}

export function updateNote(db: Db, scope: WorkspaceScope, id: string, patch: { body: string }): boolean {
  return (
    db
      .update(fixtureNotes)
      .set({ body: patch.body })
      .where(and(inWorkspace(fixtureNotes, scope), eq(fixtureNotes.id, id)))
      .returning({ id: fixtureNotes.id })
      .all().length > 0
  );
}

export function deleteNote(db: Db, scope: WorkspaceScope, id: string): boolean {
  return (
    db
      .delete(fixtureNotes)
      .where(and(inWorkspace(fixtureNotes, scope), eq(fixtureNotes.id, id)))
      .returning({ id: fixtureNotes.id })
      .all().length > 0
  );
}
