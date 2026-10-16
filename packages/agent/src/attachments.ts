import type { AttachmentItem } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { inTenant, type TenantContext } from "@momo/workspace";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { attachments, messages } from "./schema.ts";

export type NewAttachment = { name: string; contentType: string; bytes: Uint8Array };

export type Attachment = {
  id: string;
  messageId: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: Date;
};

type AttachmentRow = typeof attachments.$inferSelect;

const ID = /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const NAME_MAX = 255;

function isMissing(error: unknown): boolean {
  return (error as { code?: string }).code === "ENOENT";
}

/** Path segments come from trusted ids only; anything else would be a bug, so it throws. */
function segment(id: string): string {
  if (!ID.test(id)) throw new Error(`not an id: ${JSON.stringify(id)}`);
  return id;
}

/** A real dir owned by us with mode 0700; a symlink or another owner's dir is refused. */
function ownerOnlyDir(path: string, create: boolean): boolean {
  if (create) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
  }
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (!create && isMissing(error)) return false;
    throw error;
  }
  if (!stat.isDirectory()) throw new Error(`${path} is not a directory`);
  if (stat.uid !== process.getuid!()) throw new Error(`${path} is not ours`);
  if (create) chmodSync(path, 0o700);
  return true;
}

/**
 * Attachment bytes under `<data dir>/attachments/<workspace id>/<attachment id>`. The path is
 * built from trusted ids only, files are created exclusively without following symlinks, and
 * reads never follow one either.
 */
export class AttachmentFiles {
  constructor(readonly root: string) {}

  #dir(tenant: TenantContext, create: boolean): string | undefined {
    const dir = join(this.root, segment(tenant.workspaceId));
    if (!ownerOnlyDir(this.root, create) || !ownerOnlyDir(dir, create)) return undefined;
    return dir;
  }

  write(tenant: TenantContext, id: string, bytes: Uint8Array): void {
    const path = join(this.#dir(tenant, true)!, segment(id));
    const fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fchmodSync(fd, 0o600);
      for (let done = 0; done < bytes.length;) done += writeSync(fd, bytes, done);
    } finally {
      closeSync(fd);
    }
  }

  read(tenant: TenantContext, id: string): Uint8Array<ArrayBuffer> | undefined {
    const dir = this.#dir(tenant, false);
    if (!dir) return undefined;
    let fd: number;
    try {
      fd = openSync(join(dir, segment(id)), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    try {
      if (!fstatSync(fd).isFile()) throw new Error("attachment is not a regular file");
      return new Uint8Array(readFileSync(fd));
    } finally {
      closeSync(fd);
    }
  }

  remove(tenant: TenantContext, id: string): void {
    rmSync(join(this.root, segment(tenant.workspaceId), segment(id)), { force: true });
  }

  removeWorkspace(tenant: TenantContext): void {
    rmSync(join(this.root, segment(tenant.workspaceId)), { recursive: true, force: true });
  }

  /** Removes every id-named entry that `keep` does not list; other names are left alone. */
  sweep(keep: Map<string, Set<string>>): number {
    if (!ownerOnlyDir(this.root, false)) return 0;
    let removed = 0;
    for (const workspace of readdirSync(this.root, { withFileTypes: true })) {
      if (!ID.test(workspace.name)) continue;
      const dir = join(this.root, workspace.name);
      const ids = keep.get(workspace.name);
      if (!ids) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (!workspace.isDirectory()) continue;
      for (const file of readdirSync(dir)) {
        if (!ID.test(file) || ids.has(file)) continue;
        rmSync(join(dir, file), { force: true });
        removed++;
      }
    }
    return removed;
  }
}

/** The display name: the last path segment without control characters; never used as a path. */
export function attachmentName(given: string): string {
  const last = given.split(/[/\\]/).at(-1) ?? "";
  const clean = [...last]
    .filter((c) => c >= " " && c !== "\u007f")
    .join("")
    .trim()
    .slice(0, NAME_MAX);
  return clean === "" || clean === "." || clean === ".." ? "file" : clean;
}

function attachmentContentType(declared: string): string {
  const type = declared.split(";")[0]!.trim().toLowerCase();
  return MIME.test(type) ? type : "application/octet-stream";
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    messageId: row.messageId,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    createdAt: row.createdAt,
  };
}

export function toAttachmentItem(attachment: Attachment): AttachmentItem {
  return {
    id: attachment.id,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}

/**
 * Writes each new Attachment's file, then its row; the caller runs this inside the message's transaction
 * and removes `written` files if that transaction fails.
 */
export function insertAttachments(
  db: Db,
  tenant: TenantContext,
  input: {
    messageId: string;
    files: AttachmentFiles;
    newAttachments: NewAttachment[];
    now: Date;
    written: string[];
  },
): Attachment[] {
  return input.newAttachments.map((added) => {
    const id = `attachment_${Bun.randomUUIDv7()}`;
    input.written.push(id);
    input.files.write(tenant, id, added.bytes);
    const row = db
      .insert(attachments)
      .values({
        id,
        workspaceId: tenant.workspaceId,
        messageId: input.messageId,
        name: attachmentName(added.name),
        contentType: attachmentContentType(added.contentType),
        size: added.bytes.length,
        createdAt: input.now,
      })
      .returning()
      .get();
    return toAttachment(row);
  });
}

/** The tenant's Attachments of the given messages, keyed by message id, oldest first. */
export function attachmentsOf(
  db: Db,
  tenant: TenantContext,
  messageIds: string[],
): Map<string, Attachment[]> {
  const byMessage = new Map<string, Attachment[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = db
    .select()
    .from(attachments)
    .where(and(inTenant(attachments, tenant), inArray(attachments.messageId, messageIds)))
    .orderBy(asc(attachments.id))
    .all();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push(toAttachment(row));
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

/** An Attachment of a message in this Conversation of this Workspace, or undefined. */
export function getAttachment(
  db: Db,
  tenant: TenantContext,
  input: { conversationId: string; attachmentId: string },
): Attachment | undefined {
  const row = db
    .select({ attachment: attachments })
    .from(attachments)
    .innerJoin(
      messages,
      and(
        inTenant(messages, tenant),
        eq(messages.workspaceId, attachments.workspaceId),
        eq(messages.id, attachments.messageId),
      ),
    )
    .where(
      and(
        inTenant(attachments, tenant),
        eq(attachments.id, input.attachmentId),
        eq(messages.conversationId, input.conversationId),
      ),
    )
    .get();
  return row && toAttachment(row.attachment);
}

/** The bytes of an Attachment found with `getAttachment`; undefined if the file is gone. */
export function readAttachment(
  files: AttachmentFiles,
  tenant: TenantContext,
  attachment: Attachment,
): Uint8Array<ArrayBuffer> | undefined {
  return files.read(tenant, attachment.id);
}

/** Removes the files of Attachments whose rows a committed deletion took away. */
export function removeAttachmentFiles(files: AttachmentFiles, tenant: TenantContext, ids: string[]): void {
  for (const id of ids) files.remove(tenant, id);
}

/** Removes every Attachment file of the Workspace, for deleting the Workspace. */
export function removeWorkspaceAttachments(files: AttachmentFiles, tenant: TenantContext): void {
  files.removeWorkspace(tenant);
}

/**
 * Startup only, across Workspaces: removes Attachment files that have no row, which a stop between
 * a delete's commit and its file removal leaves behind. Returns how many files it removed, not
 * counting whole Workspace dirs.
 */
export function sweepAttachmentFiles(db: Db, files: AttachmentFiles): number {
  const keep = new Map<string, Set<string>>();
  for (const row of db
    .select({ workspaceId: attachments.workspaceId, id: attachments.id })
    .from(attachments)
    .all()) {
    const ids = keep.get(row.workspaceId) ?? new Set<string>();
    ids.add(row.id);
    keep.set(row.workspaceId, ids);
  }
  return files.sweep(keep);
}
