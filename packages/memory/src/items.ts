import { runs } from "@momo/agent";
import type { MemoryItemDraft, MemoryProvenance } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { decodeCursor, inTenant, pageLimit, toPage, type Page, type TenantContext } from "@momo/workspace";
import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { memoryItems, type MemoryWriter } from "./schema.ts";

export type MemoryRow = typeof memoryItems.$inferSelect;

/** A Memory item with who wrote it, resolved to the Conversation of each Run while it exists. */
export type MemoryRecord = MemoryRow & { created: MemoryProvenance; updated: MemoryProvenance };

const SEARCH_LIMIT = 20;
const SEARCH_TERMS_MAX = 10;
/** The trigram tokenizer cannot match shorter terms, so they go to LIKE. */
const TRIGRAM = 3;

const listName = (botId: string) => `memory_items:${botId}`;

/**
 * Writes a Memory item for the Bot of a Run that is running in the tenant. The Bot, the Run and
 * the writer come from that Run, never from the tool's arguments.
 */
export function writeMemoryItem(
  db: Db,
  tenant: TenantContext,
  input: { runId: string; item: MemoryItemDraft; now: Date },
): MemoryRecord | undefined {
  return db.transaction((tx) => {
    const run = tx
      .select({ id: runs.id, botId: runs.botId })
      .from(runs)
      .where(and(inTenant(runs, tenant), eq(runs.id, input.runId), eq(runs.status, "running")))
      .get();
    if (!run) return undefined;
    const row = tx
      .insert(memoryItems)
      .values({
        id: `memory_${Bun.randomUUIDv7()}`,
        workspaceId: tenant.workspaceId,
        botId: run.botId,
        type: input.item.type,
        title: input.item.title,
        description: input.item.description,
        tags: input.item.tags,
        resource: input.item.resource ?? null,
        body: input.item.body,
        createdBy: "bot",
        createdRunId: run.id,
        updatedBy: "bot",
        updatedRunId: run.id,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning()
      .get();
    return withProvenance(tx, tenant, eq(memoryItems.id, row.id))[0];
  });
}

export function getMemoryItem(
  db: Db,
  tenant: TenantContext,
  botId: string,
  id: string,
): MemoryRecord | undefined {
  return withProvenance(db, tenant, and(eq(memoryItems.botId, botId), eq(memoryItems.id, id)))[0];
}

/** A Bot's Memory items, newest first. */
export function listMemoryItems(
  db: Db,
  tenant: TenantContext,
  botId: string,
  options: { cursor?: string; limit?: number },
): Page<MemoryRecord> {
  const limit = pageLimit(options.limit);
  const before =
    options.cursor === undefined ? undefined : decodeCursor(tenant, listName(botId), options.cursor);
  const rows = withProvenance(
    db,
    tenant,
    and(eq(memoryItems.botId, botId), before === undefined ? undefined : lt(memoryItems.id, before)),
    limit + 1,
  );
  return toPage(tenant, listName(botId), rows, limit);
}

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (c) => `\\${c}`);
const ftsPhrase = (term: string) => `"${term.replaceAll('"', '""')}"`;

function containsTerm(term: string): SQL {
  const pattern = `%${escapeLike(term)}%`;
  const like = (column: SQL | typeof memoryItems.title) => sql`${column} LIKE ${pattern} ESCAPE '\\'`;
  return or(
    like(memoryItems.title),
    like(memoryItems.description),
    like(memoryItems.body),
    sql`EXISTS (SELECT 1 FROM json_each(${memoryItems.tags}) WHERE value LIKE ${pattern} ESCAPE '\\')`,
  )!;
}

/**
 * Full-text search over one Bot's Memory items. Every term must match. The query is limited to
 * `(workspace_id, bot_id)` inside SQL, the full-text part included, so no other Bot's item is a
 * candidate.
 */
export function searchMemoryItems(db: Db, tenant: TenantContext, botId: string, query: string): MemoryRow[] {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].slice(0, SEARCH_TERMS_MAX);
  if (terms.length === 0) return [];
  const long = terms.filter((term) => Array.from(term).length >= TRIGRAM);
  const short = terms.filter((term) => Array.from(term).length < TRIGRAM);
  const conditions: (SQL | undefined)[] = [inTenant(memoryItems, tenant), eq(memoryItems.botId, botId)];
  if (long.length > 0) {
    const match = long.map(ftsPhrase).join(" AND ");
    conditions.push(
      sql`${memoryItems.id} IN (SELECT item_id FROM memory_fts WHERE memory_fts MATCH ${match} AND workspace_id = ${tenant.workspaceId} AND bot_id = ${botId})`,
    );
  }
  conditions.push(...short.map(containsTerm));
  return db
    .select()
    .from(memoryItems)
    .where(and(...conditions))
    .orderBy(desc(memoryItems.id))
    .limit(SEARCH_LIMIT)
    .all();
}

/** Deletes the item in place; its index entry goes with it in the same statement. */
export function deleteMemoryItem(db: Db, tenant: TenantContext, botId: string, id: string): boolean {
  const deleted = db
    .delete(memoryItems)
    .where(and(inTenant(memoryItems, tenant), eq(memoryItems.botId, botId), eq(memoryItems.id, id)))
    .returning({ id: memoryItems.id })
    .all();
  return deleted.length > 0;
}

/** Deletes every Memory item of the Bot, for deleting the Bot; the index rows go with them. */
export function deleteBotMemory(db: Db, tenant: TenantContext, botId: string): number {
  return db
    .delete(memoryItems)
    .where(and(inTenant(memoryItems, tenant), eq(memoryItems.botId, botId)))
    .returning({ id: memoryItems.id })
    .all().length;
}

/** Deletes every Memory item of the Workspace, for deleting the Workspace. */
export function deleteWorkspaceMemory(db: Db, tenant: TenantContext): number {
  return db.delete(memoryItems).where(inTenant(memoryItems, tenant)).returning({ id: memoryItems.id }).all()
    .length;
}

/**
 * Empties the Run references into a Conversation that is about to be deleted, so the items stay
 * with their Bot and show a deleted Conversation as their source. The Conversation's deletion
 * calls this in its transaction before it deletes the Runs. Returns how many items changed.
 */
export function detachMemoryFromConversation(db: Db, tenant: TenantContext, conversationId: string): number {
  return db.transaction((tx) => {
    const runIds = tx
      .select({ id: runs.id })
      .from(runs)
      .where(and(inTenant(runs, tenant), eq(runs.conversationId, conversationId)))
      .all()
      .map((run) => run.id);
    if (runIds.length === 0) return 0;
    const touched = tx
      .select({ id: memoryItems.id })
      .from(memoryItems)
      .where(
        and(
          inTenant(memoryItems, tenant),
          or(inArray(memoryItems.createdRunId, runIds), inArray(memoryItems.updatedRunId, runIds)),
        ),
      )
      .all();
    tx.update(memoryItems)
      .set({ createdRunId: null })
      .where(and(inTenant(memoryItems, tenant), inArray(memoryItems.createdRunId, runIds)))
      .run();
    tx.update(memoryItems)
      .set({ updatedRunId: null })
      .where(and(inTenant(memoryItems, tenant), inArray(memoryItems.updatedRunId, runIds)))
      .run();
    return touched.length;
  });
}

function provenance(
  writer: MemoryWriter,
  runId: string | null,
  conversationId: string | null,
): MemoryProvenance {
  if (writer === "owner") return { writer: "owner" };
  if (runId === null || conversationId === null)
    return { writer: "bot", source: { kind: "deleted_conversation" } };
  return { writer: "bot", source: { kind: "conversation", conversationId, runId } };
}

function withProvenance(
  db: Db,
  tenant: TenantContext,
  where: SQL | undefined,
  limit?: number,
): MemoryRecord[] {
  const createdRun = alias(runs, "created_run");
  const updatedRun = alias(runs, "updated_run");
  const query = db
    .select({
      item: memoryItems,
      createdConversationId: createdRun.conversationId,
      updatedConversationId: updatedRun.conversationId,
    })
    .from(memoryItems)
    .leftJoin(
      createdRun,
      and(
        inTenant(createdRun, tenant),
        eq(createdRun.workspaceId, memoryItems.workspaceId),
        eq(createdRun.id, memoryItems.createdRunId),
      ),
    )
    .leftJoin(
      updatedRun,
      and(
        inTenant(updatedRun, tenant),
        eq(updatedRun.workspaceId, memoryItems.workspaceId),
        eq(updatedRun.id, memoryItems.updatedRunId),
      ),
    )
    .where(and(inTenant(memoryItems, tenant), where))
    .orderBy(desc(memoryItems.id));
  const rows = limit === undefined ? query.all() : query.limit(limit).all();
  return rows.map(({ item, createdConversationId, updatedConversationId }) => ({
    ...item,
    created: provenance(item.createdBy, item.createdRunId, createdConversationId),
    updated: provenance(item.updatedBy, item.updatedRunId, updatedConversationId),
  }));
}
