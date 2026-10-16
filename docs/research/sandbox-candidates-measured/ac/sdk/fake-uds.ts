// common/sdk/fake/server.ts with the TCP, TLS and DNS listeners replaced by one host Unix socket.
import { appendFileSync } from "node:fs";

const LOG = process.env.LOG_DIR ?? "/log";
const SELF_IP = process.env.SELF_IP!;
const log = (file: string, o: object) =>
  appendFileSync(`${LOG}/${file}`, JSON.stringify({ t: Date.now(), ...o }) + "\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastUserText(body: any): string {
  const msgs = body?.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== "user") continue;
    const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    return parts.map((p: any) => (p.type === "text" ? p.text : p.type === "tool_result" ? "[tool_result]" : `[${p.type}]`)).join(" ");
  }
  return "";
}

function allText(body: any): string {
  return JSON.stringify(body?.messages ?? []);
}

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: object };

function pickScenario(body: any): { blocks: Block[]; chunkDelay: number; pingOnlyMs: number; chunks: number } {
  const last = lastUserText(body);
  const all = allText(body);
  const isMain = (body?.tools?.length ?? 0) > 0;
  const def = { chunkDelay: 0, pingOnlyMs: 0, chunks: 1 };
  if (!isMain) return { ...def, blocks: [{ type: "text", text: "side" }] };
  if (last.includes("[tool_result]")) return { ...def, blocks: [{ type: "text", text: "TOOL_DONE" }] };
  const m = last.match(/SCENARIO:(\w+)(?::(\d+))?/);
  const s = m?.[1] ?? "basic";
  const n = Number(m?.[2] ?? 0);
  switch (s) {
    case "stream":
      return { blocks: [{ type: "text", text: "x".repeat(20) }], chunkDelay: 500, pingOnlyMs: 0, chunks: 20 };
    case "slow":
      return { blocks: [{ type: "text", text: "y".repeat(120) }], chunkDelay: 1000, pingOnlyMs: 0, chunks: 120 };
    case "ping":
      return { blocks: [{ type: "text", text: "AFTER_PING" }], chunkDelay: 0, pingOnlyMs: n * 1000, chunks: 1 };
    case "bash":
      return { ...def, blocks: [{ type: "tool_use", name: "Bash", input: { command: "sleep 600 & sleep 600", description: "sleep", timeout: 600000 } }] };
    case "grep":
      return { ...def, blocks: [{ type: "tool_use", name: "Grep", input: { pattern: "probe", path: "/app", output_mode: "files_with_matches" } }] };
    case "rg":
      return { ...def, blocks: [{ type: "tool_use", name: "Bash", input: { command: "type rg; rg --version | head -1; rg -l SCENARIO /app/probe.mjs; echo rc=$?", description: "rg" } }] };
    case "webfetch":
      return { ...def, blocks: [{ type: "tool_use", name: "WebFetch", input: { url: "https://example.com/", prompt: "summarize" } }] };
    case "mcpwait":
      return { ...def, blocks: [{ type: "tool_use", name: "mcp__momo__wait", input: { ms: n * 1000 } }] };
    case "recall": {
      const marker = all.match(/MARKER_[A-Z0-9]+/g) ?? [];
      return { ...def, blocks: [{ type: "text", text: `SEEN ${[...new Set(marker)].join(",")} MSGS ${body.messages.length}` }] };
    }
    default:
      return { ...def, blocks: [{ type: "text", text: `ECHO ${last.slice(0, 80)}` }] };
  }
}

function messageJson(body: any, blocks: Block[]) {
  return {
    id: "msg_fake", type: "message", role: "assistant", model: body.model,
    content: blocks.map((b, i) => (b.type === "text" ? b : { type: "tool_use", id: `toolu_fake${i}`, name: b.name, input: b.input })),
    stop_reason: blocks.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function sse(body: any, reqId: number) {
  const sc = pickScenario(body);
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(ctl) {
      const send = (event: string, data: object, extra: object = {}) => {
        ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        log("sse.jsonl", { reqId, event, ...extra });
      };
      try {
        const msg = messageJson(body, []);
        send("message_start", { type: "message_start", message: { ...msg, stop_reason: null } });
        if (sc.pingOnlyMs) {
          const end = Date.now() + sc.pingOnlyMs;
          while (Date.now() < end) { await sleep(10000); send("ping", { type: "ping" }); }
        }
        for (let i = 0; i < sc.blocks.length; i++) {
          const b = sc.blocks[i];
          if (b.type === "text") {
            send("content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
            const size = Math.ceil(b.text.length / sc.chunks);
            for (let c = 0; c < sc.chunks; c++) {
              if (sc.chunkDelay) await sleep(sc.chunkDelay);
              send("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text.slice(c * size, (c + 1) * size) } }, { chunk: c });
            }
          } else {
            send("content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: `toolu_fake${i}`, name: b.name, input: {} } });
            send("content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
          }
          send("content_block_stop", { type: "content_block_stop", index: i });
        }
        send("message_delta", { type: "message_delta", delta: { stop_reason: messageJson(body, sc.blocks).stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
        send("message_stop", { type: "message_stop" });
        ctl.close();
      } catch (e) {
        log("sse.jsonl", { reqId, error: String(e) });
      }
    },
    cancel(reason) { log("sse.jsonl", { reqId, cancelled: String(reason) }); },
  });
}

let seq = 0;
async function handle(req: Request, port: number): Promise<Response> {
  const url = new URL(req.url);
  const reqId = ++seq;
  const text = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch {}
  log("requests.jsonl", {
    reqId, port, method: req.method, path: url.pathname + url.search,
    headers: Object.fromEntries(req.headers),
    model: body?.model, stream: body?.stream, nTools: body?.tools?.length, nMessages: body?.messages?.length,
    lastUser: body ? lastUserText(body).slice(0, 200) : undefined,
    toolNames: body?.tools?.map((t: any) => t.name),
  });
  if (url.pathname === "/v1/messages") {
    if (body?.stream) return new Response(sse(body, reqId), { headers: { "content-type": "text/event-stream", "request-id": `req_${reqId}` } });
    return Response.json(messageJson(body, pickScenario(body).blocks), { headers: { "request-id": `req_${reqId}` } });
  }
  if (url.pathname === "/v1/messages/count_tokens") return Response.json({ input_tokens: 10 });
  if (url.pathname.startsWith("/v1/models")) return Response.json({ data: [], has_more: false, first_id: null, last_id: null });
  if (url.pathname === "/api/hello") return new Response("ok");
  return new Response("not found", { status: 404 });
}

const SOCK = process.env.SOCK!;
try { (await import("node:fs")).unlinkSync(SOCK); } catch {}
Bun.serve({ unix: SOCK, idleTimeout: 0, fetch: (r) => handle(r, 0) });
console.log("fake endpoint up", SOCK);
