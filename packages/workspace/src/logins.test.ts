import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migratedTestDatabase, type TestDatabase } from "@momo/migrator/testing";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { readFileSync } from "node:fs";
import { authenticateLogin, createLogin, listLogins, migrations, revokeLogin } from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-10-01T00:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

let testDb: TestDatabase;
const db = () => drizzle({ client: testDb.sqlite });

beforeEach(() => {
  testDb = migratedTestDatabase([migrations]);
});

afterEach(() => {
  testDb.close();
});

describe("Login", () => {
  test("authenticates with its token and not with any other", () => {
    const { login, token } = createLogin(db(), { userAgent: "Chrome", now: t0 });

    expect(authenticateLogin(db(), token, at(1))?.login.id).toBe(login.id);
    expect(authenticateLogin(db(), `${token}x`, at(1))).toBeUndefined();
    expect(authenticateLogin(db(), "", at(1))).toBeUndefined();
  });

  test("ids carry the login_ prefix on a UUIDv7", () => {
    const { login } = createLogin(db(), { userAgent: "Chrome", now: t0 });

    expect(login.id).toMatch(/^login_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("stores only a hash of the token in app.db", () => {
    const { token } = createLogin(db(), { userAgent: "Chrome", now: t0 });
    testDb.sqlite.run("PRAGMA wal_checkpoint(TRUNCATE)");

    expect(readFileSync(testDb.path).includes(Buffer.from(token))).toBe(false);
  });

  test("expires 30 days after the last use", () => {
    const { token } = createLogin(db(), { userAgent: "Chrome", now: t0 });

    expect(authenticateLogin(db(), token, at(30))).toBeUndefined();
  });

  test("slides its expiry forward on each use", () => {
    const { token } = createLogin(db(), { userAgent: "Chrome", now: t0 });

    const used = authenticateLogin(db(), token, at(29));
    expect(used?.renewed).toBe(true);
    expect(used?.login.expiresAt).toEqual(at(59));
    expect(authenticateLogin(db(), token, at(58))).toBeDefined();
    expect(authenticateLogin(db(), token, at(58 + 30))).toBeUndefined();
  });

  test("survives reopening the database", () => {
    const { token } = createLogin(db(), { userAgent: "Chrome", now: t0 });
    testDb.reopen();

    expect(authenticateLogin(db(), token, at(1))).toBeDefined();
  });

  test("lists live Logins newest first and can be revoked", () => {
    const first = createLogin(db(), { userAgent: "Safari", now: t0 });
    const second = createLogin(db(), { userAgent: "Firefox", now: at(1) });
    createLogin(db(), { userAgent: "Old", now: at(-40) });

    expect(listLogins(db(), at(2)).map((l) => l.userAgent)).toEqual(["Firefox", "Safari"]);

    expect(revokeLogin(db(), first.login.id)).toBe(true);
    expect(revokeLogin(db(), first.login.id)).toBe(false);
    expect(authenticateLogin(db(), first.token, at(2))).toBeUndefined();
    expect(listLogins(db(), at(2)).map((l) => l.id)).toEqual([second.login.id]);
  });
});
