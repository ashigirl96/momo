import {
  ATTACHMENT_SIZE_MAX,
  ATTACHMENTS_PER_MESSAGE_MAX,
  MESSAGE_TEXT_MAX,
  PostMessageRequest,
} from "@momo/contracts";
import { readAttachment, type Attachment, type AttachmentFiles, type AttachmentUpload } from "@momo/agent";
import type { TenantContext } from "@momo/workspace";
import { apiError } from "./respond.ts";
import { ATTACHMENT_CONTENT_SECURITY_POLICY } from "./security.ts";

export type PostedMessage = { text: string; uploads: AttachmentUpload[] };

// Room for the multipart boundaries and the text field on top of the files themselves.
const MULTIPART_BODY_MAX = ATTACHMENTS_PER_MESSAGE_MAX * ATTACHMENT_SIZE_MAX + 64 * 1024;

function isMultipart(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data");
}

async function readMultipart(req: Request): Promise<PostedMessage | string> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MULTIPART_BODY_MAX) return "the files are too large";
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return "expected a multipart body";
  }
  const text = form.get("text") ?? "";
  if (typeof text !== "string") return "text must be a string";
  const files = form.getAll("file");
  if (files.length > ATTACHMENTS_PER_MESSAGE_MAX) return `at most ${ATTACHMENTS_PER_MESSAGE_MAX} files`;
  const uploads: AttachmentUpload[] = [];
  for (const file of files) {
    if (typeof file === "string") return "file must be a file";
    if (file.size > ATTACHMENT_SIZE_MAX) return `each file must be at most ${ATTACHMENT_SIZE_MAX} bytes`;
    uploads.push({
      name: file.name,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  const trimmed = text.trim();
  if (trimmed.length > MESSAGE_TEXT_MAX) return `text must be at most ${MESSAGE_TEXT_MAX} characters`;
  if (trimmed === "" && uploads.length === 0) return "expected text or files";
  return { text: trimmed, uploads };
}

/** Reads `POST …/messages`: JSON `{ text }`, or a multipart body with text and files. */
export async function readPostedMessage(
  req: Request,
  body: () => Promise<unknown>,
): Promise<PostedMessage | Response> {
  if (isMultipart(req)) {
    const posted = await readMultipart(req);
    return typeof posted === "string" ? apiError("bad_request", posted) : posted;
  }
  const input = PostMessageRequest.safeParse(await body());
  if (!input.success) return apiError("bad_request", "expected { text } of 1–4000 characters");
  return { text: input.data.text, uploads: [] };
}

/** RFC 8187 `ext-value`, so any file name survives the header without breaking it. */
function encodeFilename(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The Attachment's bytes, for a sandboxed frame of the momo UI only. The CSP `sandbox` directive
 * gives the document an opaque origin without scripts even when it is opened outside that frame.
 */
export function attachmentResponse(
  files: AttachmentFiles,
  tenant: TenantContext,
  attachment: Attachment,
): Response {
  const bytes = readAttachment(files, tenant, attachment);
  if (!bytes) return apiError("not_found", "no such Attachment");
  const type = attachment.contentType.startsWith("text/")
    ? `${attachment.contentType}; charset=utf-8`
    : attachment.contentType;
  return new Response(bytes, {
    headers: {
      "content-type": type,
      "content-disposition": `inline; filename*=UTF-8''${encodeFilename(attachment.name)}`,
      "content-security-policy": ATTACHMENT_CONTENT_SECURITY_POLICY,
      "x-frame-options": "SAMEORIGIN",
      "cache-control": "no-store",
    },
  });
}
