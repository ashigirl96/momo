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

export function createFolder(db: Db, workspaceScope: WorkspaceScope, input: { name: string }): Folder {
  return db
    .insert(fixtureFolders)
    .values({ id: `folder_${Bun.randomUUIDv7()}`, workspaceId: workspaceScope.workspaceId, name: input.name })
    .returning()
    .get();
}

export function createNote(
  db: Db,
  workspaceScope: WorkspaceScope,
  input: { folderId: string; body: string },
): Note | undefined {
  const folder = db
    .select({ id: fixtureFolders.id })
    .from(fixtureFolders)
    .where(and(inWorkspace(fixtureFolders, workspaceScope), eq(fixtureFolders.id, input.folderId)))
    .get();
  if (!folder) return undefined;
  return db
    .insert(fixtureNotes)
    .values({
      id: `note_${Bun.randomUUIDv7()}`,
      workspaceId: workspaceScope.workspaceId,
      folderId: folder.id,
      body: input.body,
    })
    .returning()
    .get();
}

export function getNote(db: Db, workspaceScope: WorkspaceScope, id: string): Note | undefined {
  return db
    .select()
    .from(fixtureNotes)
    .where(and(inWorkspace(fixtureNotes, workspaceScope), eq(fixtureNotes.id, id)))
    .get();
}

export function listNotes(
  db: Db,
  workspaceScope: WorkspaceScope,
  options: { cursor?: string; limit?: number },
): Page<Note> {
  const limit = pageLimit(options.limit);
  const after =
    options.cursor === undefined ? undefined : decodeCursor(workspaceScope, "notes", options.cursor);
  const rows = db
    .select()
    .from(fixtureNotes)
    .where(
      and(
        inWorkspace(fixtureNotes, workspaceScope),
        after === undefined ? undefined : gt(fixtureNotes.id, after),
      ),
    )
    .orderBy(asc(fixtureNotes.id))
    .limit(limit + 1)
    .all();
  return toPage(workspaceScope, "notes", rows, limit);
}

export function listNotesWithFolder(
  db: Db,
  workspaceScope: WorkspaceScope,
): { body: string; folderName: string }[] {
  return db
    .select({ body: fixtureNotes.body, folderName: fixtureFolders.name })
    .from(fixtureNotes)
    .innerJoin(
      fixtureFolders,
      and(
        inWorkspace(fixtureFolders, workspaceScope),
        eq(fixtureFolders.workspaceId, fixtureNotes.workspaceId),
        eq(fixtureFolders.id, fixtureNotes.folderId),
      ),
    )
    .where(inWorkspace(fixtureNotes, workspaceScope))
    .orderBy(asc(fixtureNotes.id))
    .all();
}

export function updateNote(
  db: Db,
  workspaceScope: WorkspaceScope,
  id: string,
  patch: { body: string },
): boolean {
  return (
    db
      .update(fixtureNotes)
      .set({ body: patch.body })
      .where(and(inWorkspace(fixtureNotes, workspaceScope), eq(fixtureNotes.id, id)))
      .returning({ id: fixtureNotes.id })
      .all().length > 0
  );
}

export function deleteNote(db: Db, workspaceScope: WorkspaceScope, id: string): boolean {
  return (
    db
      .delete(fixtureNotes)
      .where(and(inWorkspace(fixtureNotes, workspaceScope), eq(fixtureNotes.id, id)))
      .returning({ id: fixtureNotes.id })
      .all().length > 0
  );
}
