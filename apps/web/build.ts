import tailwind from "bun-plugin-tailwind";
import { fileURLToPath } from "node:url";

export type WebAsset = {
  body: Blob;
  contentType: string;
};

/**
 * Bundles the UI in memory, keyed by the absolute URL path each file is served at.
 * Served from the backend's own handler, because HTML-import routes in Bun.serve
 * bypass the handler and so skip the Host check and the security headers.
 */
export async function buildWeb(): Promise<Map<string, WebAsset>> {
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./index.html", import.meta.url))],
    publicPath: "/",
    minify: true,
    target: "browser",
    plugins: [tailwind],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) throw new AggregateError(result.logs, "web build failed");
  return new Map(
    result.outputs.map((output) => [
      output.path.replace(/^\.\//, "/"),
      { body: output, contentType: output.type },
    ]),
  );
}
