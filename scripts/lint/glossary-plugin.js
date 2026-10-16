import { readFileSync } from "node:fs";
import { basename } from "node:path";

const allowedInCode = {
  agent: "ADR-0008 names the `agent` domain, and HTTP has User-Agent",
  api: "the backend's HTTP API",
  action: "UI actions",
  credential: "fetch's `credentials` option",
  file: "files on disk; Attachment avoids it only as a name for an Attachment",
  host: "the HTTP Host header",
  note: "the test-only `fixture` domain stores notes",
  request: "HTTP requests",
  runner: "ADR-0009 names the runner that executes a Run",
  scope: "WorkspaceScope; Grant avoids it only as a name for a Grant",
  session: "Session is a glossary term; Login avoids it only as a name for a Login",
};

const glossary = readFileSync(new URL("../../GLOSSARY.md", import.meta.url), "utf8");

const words = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase().replace(/s$/, ""));

const avoided = [...glossary.matchAll(/^\*\*(.+?)\*\*:\n(?:.*\n)*?_Avoid_: (.+)$/gm)].flatMap(
  ([, entry, list]) =>
    list
      .split(",")
      .map((term) => term.trim())
      .filter((term) => !(term.toLowerCase() in allowedInCode))
      .map((term) => ({ term, entry, words: words(term) })),
);

const avoidedIn = (name) => {
  const nameWords = words(name);
  return avoided.filter(({ words: termWords }) =>
    nameWords.some((_, start) => termWords.every((word, offset) => nameWords[start + offset] === word)),
  );
};

const declaresName = (node) => {
  const parent = node.parent;
  if (!parent) return false;
  if ("id" in parent && parent.id === node) return true;
  if ("key" in parent && parent.key === node)
    return parent.type !== "Property" || parent.parent?.type === "ObjectExpression";
  return Array.isArray(parent.params) && parent.params.includes(node);
};

const report = (context, node, name) => {
  for (const { term, entry } of avoidedIn(name))
    context.report({
      node,
      message: `\`${name}\` uses "${term}", which GLOSSARY.md avoids for ${entry}. Name it with the glossary term.`,
    });
};

export default {
  meta: { name: "glossary" },
  rules: {
    "avoided-term": {
      create(context) {
        return {
          Program(node) {
            report(context, node, basename(context.filename).replace(/\..*$/, ""));
          },
          Identifier(node) {
            if (declaresName(node)) report(context, node, node.name);
          },
        };
      },
    },
  },
};
