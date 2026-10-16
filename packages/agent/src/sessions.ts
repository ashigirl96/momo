import type { Db } from "@momo/migrator";
import { inTenant, type TenantContext } from "@momo/workspace";
import { and, eq } from "drizzle-orm";
import { sessions } from "./schema.ts";

export type Session = typeof sessions.$inferSelect;

/**
 * The open Session of the Bot in the Conversation, opened now if there is none. Callers check that
 * the Bot takes part in the tenant's Conversation; the composite key refuses anything else.
 */
export function openSession(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; botId: string; now: Date },
): Session {
  const open = db
    .select()
    .from(sessions)
    .where(
      and(
        inTenant(sessions, tenant),
        eq(sessions.conversationId, input.conversationId),
        eq(sessions.botId, input.botId),
        eq(sessions.status, "open"),
      ),
    )
    .get();
  if (open) return open;
  return db
    .insert(sessions)
    .values({
      id: `session_${Bun.randomUUIDv7()}`,
      workspaceId: tenant.workspaceId,
      conversationId: input.conversationId,
      botId: input.botId,
      status: "open",
      openedAt: input.now,
    })
    .returning()
    .get();
}

export function getSession(db: Db, tenant: TenantContext, id: string): Session | undefined {
  return db
    .select()
    .from(sessions)
    .where(and(inTenant(sessions, tenant), eq(sessions.id, id)))
    .get();
}
