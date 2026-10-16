import type { AttachmentItem } from "@momo/contracts";
import type { Db } from "@momo/migrator";
import { inWorkspace, type WorkspaceScope } from "@momo/workspace";
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

/** Files are created exclusively without following symlinks, and reads never follow one either. */
export class AttachmentFiles {
  constructor(readonly root: string) {}

  #dir(scope: WorkspaceScope, create: boolean): string | undefined {
    const dir = join(this.root, segment(scope.workspaceId));
    if (!ownerOnlyDir(this.root, create) || !ownerOnlyDir(dir, create)) return undefined;
    return dir;
  }

  write(scope: WorkspaceScope, id: string, bytes: Uint8Array): void {
    const path = join(this.#dir(scope, true)!, segment(id));
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

  read(scope: WorkspaceScope, id: string): Uint8Array<ArrayBuffer> | undefined {
    const dir = this.#dir(scope, false);
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

  remove(scope: WorkspaceScope, id: string): void {
    rmSync(join(this.root, segment(scope.workspaceId), segment(id)), { force: true });
  }

  removeWorkspace(scope: WorkspaceScope): void {
    rmSync(join(this.root, segment(scope.workspaceId)), { recursive: true, force: true });
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

/** The caller runs this inside the message's transaction and removes `written` files if it fails. */
export function insertAttachments(
  db: Db,
  scope: WorkspaceScope,
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
    input.files.write(scope, id, added.bytes);
    const row = db
      .insert(attachments)
      .values({
        id,
        workspaceId: scope.workspaceId,
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

export function attachmentsOf(
  db: Db,
  scope: WorkspaceScope,
  messageIds: string[],
): Map<string, Attachment[]> {
  const byMessage = new Map<string, Attachment[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = db
    .select()
    .from(attachments)
    .where(and(inWorkspace(attachments, scope), inArray(attachments.messageId, messageIds)))
    .orderBy(asc(attachments.id))
    .all();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push(toAttachment(row));
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

export function getAttachment(
  db: Db,
  scope: WorkspaceScope,
  input: { conversationId: string; attachmentId: string },
): Attachment | undefined {
  const row = db
    .select({ attachment: attachments })
    .from(attachments)
    .innerJoin(
      messages,
      and(
        inWorkspace(messages, scope),
        eq(messages.workspaceId, attachments.workspaceId),
        eq(messages.id, attachments.messageId),
      ),
    )
    .where(
      and(
        inWorkspace(attachments, scope),
        eq(attachments.id, input.attachmentId),
        eq(messages.conversationId, input.conversationId),
      ),
    )
    .get();
  return row && toAttachment(row.attachment);
}

export function readAttachment(
  files: AttachmentFiles,
  scope: WorkspaceScope,
  attachment: Attachment,
): Uint8Array<ArrayBuffer> | undefined {
  return files.read(scope, attachment.id);
}

export function removeAttachmentFiles(files: AttachmentFiles, scope: WorkspaceScope, ids: string[]): void {
  for (const id of ids) files.remove(scope, id);
}

export function removeWorkspaceAttachments(files: AttachmentFiles, scope: WorkspaceScope): void {
  files.removeWorkspace(scope);
}

/** Removes Attachment files without a row, which a stop between a delete's commit and its file removal leaves behind. */
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
