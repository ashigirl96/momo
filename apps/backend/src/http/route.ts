import type { AttachmentFiles } from "@momo/agent";
import type { Db } from "@momo/migrator";
import { InvalidCursor } from "@momo/workspace";
import type { ConversationHub } from "../conversation-hub.ts";
import type { RunLoop } from "../run-loop.ts";
import { apiError } from "./respond.ts";

export type RouteContext = {
  db: Db;
  now: () => Date;
  runs: RunLoop;
  hub: ConversationHub;
  attachments: AttachmentFiles;
  streamCheckMs: number;
};

/** A malformed percent-encoding gives undefined, which callers answer as not found. */
export function decode(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function listQuery(req: Request): { cursor?: string; limit?: number } {
  const query = new URL(req.url).searchParams;
  const cursor = query.get("cursor") ?? undefined;
  const limit = query.has("limit") ? Number(query.get("limit")) : undefined;
  return { cursor, limit };
}

export function paged(read: () => Response): Response {
  try {
    return read();
  } catch (error) {
    if (error instanceof InvalidCursor) return apiError("bad_request", "invalid cursor");
    throw error;
  }
}
