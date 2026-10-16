// Stand-in for securityd's model route: swaps the sandbox's placeholder Bearer for the owner's token and streams the reply through.
import { appendFileSync, readFileSync } from "node:fs";

const UPSTREAM = process.env.UPSTREAM!;
const PLACEHOLDER = process.env.PLACEHOLDER!;
const TOKEN = readFileSync("/secret/token", "utf8").trim();
const ADD_BETA = process.env.ADD_BETA ?? "";
const ALLOWED = new Set(["POST /v1/messages", "HEAD /api/hello"]);
const log = (o: object) => appendFileSync("/log/proxy.jsonl", JSON.stringify({ t: Date.now(), ...o }) + "\n");
const redact = (s: string) => s.replaceAll(TOKEN, "<TOKEN>");

const HOP = ["host", "connection", "content-length", "accept-encoding", "authorization", "x-api-key"];

Bun.serve({
  port: 8080, idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    const sent = req.headers.get("authorization");
    if (!ALLOWED.has(route)) { log({ route, verdict: "deny-route" }); return new Response("denied", { status: 403 }); }
    if (sent !== `Bearer ${PLACEHOLDER}`) { log({ route, verdict: "deny-credential" }); return Response.json({ type: "error", error: { type: process.env.DENY_TYPE ?? "authentication_error", message: "momo: credential rejected" } }, { status: Number(process.env.DENY_STATUS ?? 401) }); }
    const headers = new Headers();
    for (const [k, v] of req.headers) if (!HOP.includes(k)) headers.set(k, v);
    headers.set("authorization", `Bearer ${TOKEN}`);
    if (ADD_BETA) headers.set("anthropic-beta", [req.headers.get("anthropic-beta"), ADD_BETA].filter(Boolean).join(","));
    const t0 = Date.now();
    const res = await fetch(UPSTREAM + url.pathname + url.search, {
      method: req.method, headers, body: req.method === "HEAD" ? undefined : await req.arrayBuffer(), decompress: false,
    } as RequestInit);
    log({ route, verdict: "forwarded", rl: [...res.headers.keys()].filter((k) => /ratelimit|unified|organization/.test(k)).map((k) => k + "=" + (/organization/.test(k) ? "<set>" : res.headers.get(k))), status: res.status, ct: res.headers.get("content-type"), beta: headers.get("anthropic-beta"), ms: Date.now() - t0 });
    if (res.status >= 400) {
      const body = redact(await res.text());
      log({ route, errorBody: body.slice(0, 600) });
      return new Response(body, { status: res.status, headers: res.headers });
    }
    let chunks = 0;
    const body = res.body && res.body.pipeThrough(new TransformStream({
      transform(c, ctl) { chunks++; if (chunks <= 3 || chunks % 20 === 0) log({ route, chunk: chunks, dt: Date.now() - t0, bytes: c.byteLength }); ctl.enqueue(c); },
      flush() { log({ route, chunks, done: Date.now() - t0 }); },
    }));
    return new Response(body, { status: res.status, headers: res.headers });
  },
});
console.log("proxy up ->", UPSTREAM);
