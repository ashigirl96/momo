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

/** The text comes from a Bot, so raw HTML is dropped, images are not loaded and unsafe link targets are removed. */
export function MessageText({ text }: { text: string }) {
  return (
    <Markdown skipHtml disallowedElements={["img"]} unwrapDisallowed components={components}>
      {text}
    </Markdown>
  );
}
