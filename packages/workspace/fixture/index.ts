/** A test-only domain that never reaches app.db; it is the template for a Workspace-owned table. */
import type { Db } from "@momo/migrator";
import { and, asc, eq, gt } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { decodeCursor, pageLimit, toPage, type Page } from "../src/paging.ts";
import { inTenant } from "../src/scoped.ts";
import type { TenantContext } from "../src/tenant.ts";
import { fixtureFolders, fixtureNotes } from "./schema.ts";

export const migrations = {
  domain: "fixture",
  dir: fileURLToPath(new URL("./migrations", import.meta.url)),
};

type Folder = typeof fixtureFolders.$inferSelect;
type Note = typeof fixtureNotes.$inferSelect;

export function createFolder(db: Db, tenant: TenantContext, input: { name: string }): Folder {
  return db
    .insert(fixtureFolders)
    .values({ id: `folder_${Bun.randomUUIDv7()}`, workspaceId: tenant.workspaceId, name: input.name })
    .returning()
    .get();
}

export function createNote(
  db: Db,
  tenant: TenantContext,
  input: { folderId: string; body: string },
): Note | undefined {
  const folder = db
    .select({ id: fixtureFolders.id })
    .from(fixtureFolders)
    .where(and(inTenant(fixtureFolders, tenant), eq(fixtureFolders.id, input.folderId)))
    .get();
  if (!folder) return undefined;
  return db
    .insert(fixtureNotes)
    .values({
      id: `note_${Bun.randomUUIDv7()}`,
      workspaceId: tenant.workspaceId,
      folderId: folder.id,
      body: input.body,
    })
    .returning()
    .get();
}

export function getNote(db: Db, tenant: TenantContext, id: string): Note | undefined {
  return db
    .select()
    .from(fixtureNotes)
    .where(and(inTenant(fixtureNotes, tenant), eq(fixtureNotes.id, id)))
    .get();
}

export function listNotes(
  db: Db,
  tenant: TenantContext,
  options: { cursor?: string; limit?: number },
): Page<Note> {
  const limit = pageLimit(options.limit);
  const after = options.cursor === undefined ? undefined : decodeCursor(tenant, "notes", options.cursor);
  const rows = db
    .select()
    .from(fixtureNotes)
    .where(and(inTenant(fixtureNotes, tenant), after === undefined ? undefined : gt(fixtureNotes.id, after)))
    .orderBy(asc(fixtureNotes.id))
    .limit(limit + 1)
    .all();
  return toPage(tenant, "notes", rows, limit);
}

export function listNotesWithFolder(db: Db, tenant: TenantContext): { body: string; folderName: string }[] {
  return db
    .select({ body: fixtureNotes.body, folderName: fixtureFolders.name })
    .from(fixtureNotes)
    .innerJoin(
      fixtureFolders,
      and(
        inTenant(fixtureFolders, tenant),
        eq(fixtureFolders.workspaceId, fixtureNotes.workspaceId),
        eq(fixtureFolders.id, fixtureNotes.folderId),
      ),
    )
    .where(inTenant(fixtureNotes, tenant))
    .orderBy(asc(fixtureNotes.id))
    .all();
}

export function updateNote(db: Db, tenant: TenantContext, id: string, patch: { body: string }): boolean {
  return (
    db
      .update(fixtureNotes)
      .set({ body: patch.body })
      .where(and(inTenant(fixtureNotes, tenant), eq(fixtureNotes.id, id)))
      .returning({ id: fixtureNotes.id })
      .all().length > 0
  );
}

export function deleteNote(db: Db, tenant: TenantContext, id: string): boolean {
  return (
    db
      .delete(fixtureNotes)
      .where(and(inTenant(fixtureNotes, tenant), eq(fixtureNotes.id, id)))
      .returning({ id: fixtureNotes.id })
      .all().length > 0
  );
}
