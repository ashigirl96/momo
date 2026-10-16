import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createWorkspace, listWorkspaces, migrations, resolveTenant, type Actor } from "./index.ts";

const owner: Actor = { kind: "owner", loginId: "login_test" };
const t0 = new Date("2026-10-01T00:00:00Z");

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });

beforeEach(() => {
  testDb = migratedTestDatabase([migrations]);
});

afterEach(() => {
  testDb.close();
});

describe("Workspace", () => {
  test("ids carry the workspace_ prefix on a UUIDv7", () => {
    const workspace = createWorkspace(db(), { name: "個人", now: t0 });

    expect(workspace.id).toMatch(
      /^workspace_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  test("lists Workspaces in creation order, even within one millisecond", () => {
    const names = ["個人", "会社 A", "会社 B", "趣味"];
    for (const name of names) createWorkspace(db(), { name, now: t0 });

    expect(listWorkspaces(db()).map((w) => w.name)).toEqual(names);
  });

  test("survives reopening the database", () => {
    const created = createWorkspace(db(), { name: "個人", now: t0 });
    testDb.reopen();

    expect(listWorkspaces(db())).toEqual([created]);
  });

  test("trims the name and refuses an empty or overlong one", () => {
    expect(createWorkspace(db(), { name: "  個人  ", now: t0 }).name).toBe("個人");
    expect(() => createWorkspace(db(), { name: "   ", now: t0 })).toThrow();
    expect(() => createWorkspace(db(), { name: "x".repeat(51), now: t0 })).toThrow();
  });
});

describe("TenantContext", () => {
  test("resolves only for a Workspace that exists", () => {
    const workspace = createWorkspace(db(), { name: "個人", now: t0 });

    const tenant = resolveTenant(db(), workspace.id, owner);
    expect(tenant?.workspace).toEqual(workspace);
    expect(tenant?.workspaceId).toBe(workspace.id);
    expect(tenant?.actor).toEqual(owner);
  });

  test("does not fall back to another Workspace for an unknown or malformed id", () => {
    createWorkspace(db(), { name: "個人", now: t0 });

    expect(resolveTenant(db(), `workspace_${Bun.randomUUIDv7()}`, owner)).toBeUndefined();
    expect(resolveTenant(db(), "", owner)).toBeUndefined();
    expect(resolveTenant(db(), "default", owner)).toBeUndefined();
  });
});
