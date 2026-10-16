import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AttachmentFrame } from "./attachment-frame.tsx";

test("an Attachment is drawn in a frame with every sandbox permission off", () => {
  const html = renderToStaticMarkup(
    <AttachmentFrame
      attachment={{ id: "attachment_1", name: "plan.html", contentType: "text/html", size: 2048 }}
      src="/api/workspaces/w/conversations/c/attachments/attachment_1"
    />,
  );
  const frame = iframeAttributes(html);
  expect(frame.sandbox).toBe("");
  expect(frame.src).toBe("/api/workspaces/w/conversations/c/attachments/attachment_1");
  expect(html).not.toContain("allow-");
  expect(html).toContain("plan.html");
  expect(html).toContain("2.0 KB");
});

function iframeAttributes(html: string) {
  const tag = /<iframe\b[^>]*>/.exec(html)?.[0] ?? "";
  return { sandbox: /\ssandbox="([^"]*)"/.exec(tag)?.[1], src: /\ssrc="([^"]*)"/.exec(tag)?.[1] };
}
