import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageText } from "./message-text.tsx";

const render = (text: string) => renderToStaticMarkup(<MessageText text={text} />);

describe("message Markdown", () => {
  test("renders Markdown formatting", () => {
    expect(render("**太字** と `code`\n\n- 項目")).toBe(
      "<p><strong>太字</strong> と <code>code</code></p>\n<ul>\n<li>項目</li>\n</ul>",
    );
  });

  test("never turns message text into script, event handlers or script URLs", () => {
    const html = render(
      [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(1)">',
        '<a href="javascript:alert(1)">a</a>',
        "[link](javascript:alert(1))",
        "[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
        "![img](https://example.com/x.png)",
        '<iframe src="https://example.com"></iframe>',
        '<div style="background:url(x)" onclick="alert(1)">x</div>',
      ].join("\n\n"),
    );

    expect(html).not.toMatch(/<script|<iframe|<img|<div|onerror|onclick|javascript:|data:text|style=/i);
    expect(html).not.toContain("<a ");
  });

  test("links open outside the app without a referrer or opener", () => {
    expect(render("[momo](https://example.com/a)")).toBe(
      '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer nofollow">momo</a></p>',
    );
  });
});
