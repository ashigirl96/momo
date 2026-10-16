import type { AttachmentItem } from "@momo/contracts";

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Shows an Attachment in a frame with every sandbox permission off, so its document has an opaque
 * origin and runs no script; the response's own `CSP: sandbox` holds even outside this frame.
 */
export function AttachmentFrame({ attachment, src }: { attachment: AttachmentItem; src: string }) {
  return (
    <figure
      data-testid="attachment"
      className="bg-background text-foreground overflow-hidden rounded-lg border"
    >
      <iframe
        src={src}
        sandbox=""
        title={attachment.name}
        referrerPolicy="no-referrer"
        loading="lazy"
        className="h-48 w-72 bg-white"
      />
      <figcaption className="flex justify-between gap-2 px-2 py-1 text-xs">
        <span className="truncate">{attachment.name}</span>
        <span className="text-muted-foreground shrink-0">{size(attachment.size)}</span>
      </figcaption>
    </figure>
  );
}
