import { desc, eq, gt, lte } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@momo/migrator";
import { logins } from "./schema.ts";

export type Login = typeof logins.$inferSelect;
export type LoginSummary = Omit<Login, "tokenHash">;

export const LOGIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Bounds writes to one per minute per Login while keeping the 30-day window sliding.
const RENEW_AFTER_MS = 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function summary({ tokenHash: _tokenHash, ...rest }: Login): LoginSummary {
  return rest;
}

export function createLogin(
  db: Db,
  input: { userAgent: string; now: Date },
): { login: LoginSummary; token: string } {
  const token = randomBytes(32).toString("base64url");
  const row = db
    .insert(logins)
    .values({
      id: `login_${Bun.randomUUIDv7()}`,
      tokenHash: hashToken(token),
      userAgent: input.userAgent.slice(0, 300),
      createdAt: input.now,
      lastUsedAt: input.now,
      expiresAt: new Date(input.now.getTime() + LOGIN_TTL_MS),
    })
    .returning()
    .get();
  return { login: summary(row), token };
}

/**
 * Resolves a cookie token to its live Login and slides the expiry forward.
 * `renewed` tells the caller to send the cookie again with a fresh Max-Age.
 */
export function authenticateLogin(
  db: Db,
  token: string,
  now: Date,
): { login: LoginSummary; renewed: boolean } | undefined {
  if (token === "") return undefined;
  const row = db
    .select()
    .from(logins)
    .where(eq(logins.tokenHash, hashToken(token)))
    .get();
  if (!row) return undefined;
  if (row.expiresAt.getTime() <= now.getTime()) {
    db.delete(logins).where(eq(logins.id, row.id)).run();
    return undefined;
  }
  if (now.getTime() - row.lastUsedAt.getTime() < RENEW_AFTER_MS)
    return { login: summary(row), renewed: false };
  const renewed = db
    .update(logins)
    .set({ lastUsedAt: now, expiresAt: new Date(now.getTime() + LOGIN_TTL_MS) })
    .where(eq(logins.id, row.id))
    .returning()
    .get();
  return { login: summary(renewed!), renewed: true };
}

export function listLogins(db: Db, now: Date): LoginSummary[] {
  db.delete(logins).where(lte(logins.expiresAt, now)).run();
  return db
    .select()
    .from(logins)
    .where(gt(logins.expiresAt, now))
    .orderBy(desc(logins.createdAt))
    .all()
    .map(summary);
}

export function revokeLogin(db: Db, id: string): boolean {
  return db.delete(logins).where(eq(logins.id, id)).returning({ id: logins.id }).all().length > 0;
}
