import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import { drizzle } from "drizzle-orm/bun-sqlite";
import {
  createWorkspace,
  decodeCursor,
  encodeCursor,
  InvalidCursor,
  migrations as workspaceMigrations,
  resolveWorkspaceScope,
  type WorkspaceScope,
} from "../src/index.ts";
import { workspaceOwnedTableProblems } from "../src/testing.ts";
import {
  createFolder,
  createNote,
  deleteNote,
  getNote,
  listNotes,
  listNotesWithFolder,
  migrations as fixtureMigrations,
  updateNote,
} from "./index.ts";

const now = new Date("2026-10-01T00:00:00Z");
const owner = { kind: "owner", loginId: "login_test" } as const;

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });
let a: WorkspaceScope;
let b: WorkspaceScope;

beforeEach(() => {
  testDb = migratedTestDatabase([workspaceMigrations, fixtureMigrations]);
  a = resolveWorkspaceScope(db(), createWorkspace(db(), { name: "A", now }).id, owner)!;
  b = resolveWorkspaceScope(db(), createWorkspace(db(), { name: "B", now }).id, owner)!;
});

afterEach(() => {
  testDb.close();
});

describe("Workspace-owned rows", () => {
  test("the fixture tables follow every Workspace-owned table rule", () => {
    expect(workspaceOwnedTableProblems(testDb.sqlite)).toEqual([]);
  });

  test("a child cannot reference a parent in another Workspace, even bypassing the domain functions", () => {
    const folderOfB = createFolder(db(), b, { name: "B のフォルダ" });

    expect(createNote(db(), a, { folderId: folderOfB.id, body: "x" })).toBeUndefined();
    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO fixture_notes (id, workspace_id, folder_id, body) VALUES ('note_x', ?, ?, 'x')",
        [a.workspaceId, folderOfB.id],
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("workspace_id cannot be changed, even bypassing the domain functions", () => {
    const folder = createFolder(db(), a, { name: "A のフォルダ" });

    expect(() =>
      testDb.sqlite.run("UPDATE fixture_folders SET workspace_id = ? WHERE id = ?", [
        b.workspaceId,
        folder.id,
      ]),
    ).toThrow(/workspace_id is immutable/);
  });

  test("a row needs a Workspace that exists", () => {
    expect(() =>
      testDb.sqlite.run(
        "INSERT INTO fixture_folders (id, workspace_id, name) VALUES ('folder_x', 'workspace_x', 'x')",
      ),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe("domain operations under a WorkspaceScope", () => {
  test("read, update and delete with another Workspace's WorkspaceScope touch nothing", () => {
    const folder = createFolder(db(), a, { name: "A のフォルダ" });
    const note = createNote(db(), a, { folderId: folder.id, body: "A のメモ" })!;

    expect(getNote(db(), b, note.id)).toBeUndefined();
    expect(updateNote(db(), b, note.id, { body: "上書き" })).toBe(false);
    expect(deleteNote(db(), b, note.id)).toBe(false);

    expect(getNote(db(), a, note.id)?.body).toBe("A のメモ");
    expect(updateNote(db(), a, note.id, { body: "更新" })).toBe(true);
    expect(getNote(db(), a, note.id)?.body).toBe("更新");
    expect(deleteNote(db(), a, note.id)).toBe(true);
    expect(getNote(db(), a, note.id)).toBeUndefined();
  });

  test("lists and JOINs see only their own Workspace", () => {
    const folderOfA = createFolder(db(), a, { name: "A のフォルダ" });
    const folderOfB = createFolder(db(), b, { name: "B のフォルダ" });
    createNote(db(), a, { folderId: folderOfA.id, body: "A のメモ" });
    createNote(db(), b, { folderId: folderOfB.id, body: "B のメモ" });

    expect(listNotes(db(), a, {}).items.map((n) => n.body)).toEqual(["A のメモ"]);
    expect(listNotesWithFolder(db(), b)).toEqual([{ body: "B のメモ", folderName: "B のフォルダ" }]);
  });
});

describe("paging cursor", () => {
  test("pages through one Workspace's list in creation order", () => {
    const folder = createFolder(db(), a, { name: "A のフォルダ" });
    for (const body of ["1", "2", "3", "4", "5"]) createNote(db(), a, { folderId: folder.id, body });

    const first = listNotes(db(), a, { limit: 2 });
    const second = listNotes(db(), a, { limit: 2, cursor: first.nextCursor });
    const last = listNotes(db(), a, { limit: 2, cursor: second.nextCursor });

    expect([first, second, last].map((p) => p.items.map((n) => n.body))).toEqual([
      ["1", "2"],
      ["3", "4"],
      ["5"],
    ]);
    expect(last.nextCursor).toBeUndefined();
  });

  test("a cursor from another Workspace is refused", () => {
    const folder = createFolder(db(), a, { name: "A のフォルダ" });
    for (const body of ["1", "2", "3"]) createNote(db(), a, { folderId: folder.id, body });
    const cursorOfA = listNotes(db(), a, { limit: 1 }).nextCursor!;

    expect(() => listNotes(db(), b, { cursor: cursorOfA })).toThrow(InvalidCursor);
  });

  test("a cursor from another list, or a malformed one, is refused", () => {
    expect(() => decodeCursor(a, "notes", encodeCursor(a, "folders", "x"))).toThrow(InvalidCursor);
    expect(() => decodeCursor(a, "notes", "not a cursor")).toThrow(InvalidCursor);
    expect(decodeCursor(a, "notes", encodeCursor(a, "notes", "x"))).toBe("x");
  });
});
