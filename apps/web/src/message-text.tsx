import Markdown, { type Components } from "react-markdown";

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

/**
 * Draws a public message's Markdown as React elements. Raw HTML is dropped, images are not
 * loaded, and react-markdown's URL filter removes `javascript:` and other unsafe link targets.
 */
export function MessageText({ text }: { text: string }) {
  return (
    <Markdown skipHtml disallowedElements={["img"]} unwrapDisallowed components={components}>
      {text}
    </Markdown>
  );
}
