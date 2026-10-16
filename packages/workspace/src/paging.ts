import type { TenantContext } from "./tenant.ts";

export type Page<T> = { items: T[]; nextCursor?: string };

export const PAGE_LIMIT_MAX = 100;

export class InvalidCursor extends Error {
  override readonly name = "InvalidCursor";
}

type CursorBody = { w: string; l: string; a: string };

/** A cursor that only the same list in the same Workspace accepts. */
export function encodeCursor(tenant: TenantContext, list: string, afterId: string): string {
  const body: CursorBody = { w: tenant.workspaceId, l: list, a: afterId };
  return Buffer.from(JSON.stringify(body)).toString("base64url");
}

/** Throws InvalidCursor for a cursor of another Workspace or list. */
export function decodeCursor(tenant: TenantContext, list: string, cursor: string): string {
  let body: Partial<CursorBody>;
  try {
    body = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursor("malformed cursor");
  }
  if (body.w !== tenant.workspaceId) throw new InvalidCursor("cursor belongs to another Workspace");
  if (body.l !== list || typeof body.a !== "string")
    throw new InvalidCursor("cursor belongs to another list");
  return body.a;
}

export function pageLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isInteger(requested)) return PAGE_LIMIT_MAX;
  return Math.min(Math.max(requested, 1), PAGE_LIMIT_MAX);
}

/** Rows must be fetched with `limit + 1` and ordered by id. */
export function toPage<T extends { id: string }>(
  tenant: TenantContext,
  list: string,
  rows: T[],
  limit: number,
): Page<T> {
  if (rows.length <= limit) return { items: rows };
  const items = rows.slice(0, limit);
  return { items, nextCursor: encodeCursor(tenant, list, items.at(-1)!.id) };
}
