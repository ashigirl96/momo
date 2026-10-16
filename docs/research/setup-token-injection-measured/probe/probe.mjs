// Probe for the Agent SDK. Runs unchanged under Bun and Node. Usage: <runtime> probe.mjs <mode>[:args]
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { readdirSync, readFileSync, writeFileSync, readlinkSync } from "node:fs";

const t0 = Date.now();
const out = (o) => console.log(JSON.stringify({ dt: Date.now() - t0, t: Date.now(), ...o }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;

function procs() {
  const rows = [];
  for (const p of readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    try {
      const cmd = readFileSync(`/proc/${p}/cmdline`, "latin1").split("\0").join(" ").trim();
      let exe = "";
      try { exe = readlinkSync(`/proc/${p}/exe`); } catch {}
      const stat = readFileSync(`/proc/${p}/stat`, "latin1").split(") ")[1].split(" ");
      rows.push({ pid: +p, ppid: +stat[1], state: stat[0], exe, cmd: cmd.slice(0, 160) });
    } catch {}
  }
  return rows;
}

const [mode, ...args] = (process.argv[2] ?? "basic").split(":");
const skipPreflight = process.env.SKIP_PREFLIGHT === "1";
const stderrLines = [];
const base = {
  cwd: process.env.WORK ?? "/work",
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  settingSources: [],
  stderr: (d) => stderrLines.push(d),
  ...(skipPreflight ? { settings: { skipWebFetchPreflight: true } } : {}),
};

function summarize(m) {
  switch (m.type) {
    case "system":
      return m.subtype === "init"
        ? { type: "system/init", session_id: m.session_id, model: m.model, cwd: m.cwd, claude_code_version: m.claude_code_version, apiKeySource: m.apiKeySource, nTools: m.tools?.length, mcp: m.mcp_servers }
        : { type: `system/${m.subtype}` };
    case "assistant":
      return { type: "assistant", content: m.message.content.map((c) => c.type === "text" ? { text: c.text.slice(0, 80) } : { [c.type]: c.name ?? "" }), err: m.error };
    case "user":
      return { type: "user", content: (Array.isArray(m.message.content) ? m.message.content : []).map((c) => ({ [c.type]: JSON.stringify(c.content ?? c.text ?? "").slice(0, 200) })) };
    case "result":
      return { type: "result", subtype: m.subtype, is_error: m.is_error, result: m.result?.slice?.(0, 200), session_id: m.session_id, errors: m.errors, duration_ms: m.duration_ms };
    case "stream_event":
      return { type: "stream_event", ev: m.event.type, text: m.event.delta?.text };
    default:
      return { type: m.type, subtype: m.subtype };
  }
}

async function drain(q, onMsg = () => {}) {
  let last;
  try {
    for await (const m of q) {
      last = m;
      if (m.type !== "stream_event" || process.env.VERBOSE_STREAM) out({ msg: summarize(m) });
      await onMsg(m);
    }
    out({ end: "returned", last: last && summarize(last) });
  } catch (e) {
    out({ end: "threw", name: e?.constructor?.name, message: String(e?.message ?? e).slice(0, 300), last: last && summarize(last) });
  }
  return last;
}

out({ runtime, mode, args, glibcVersionRuntime: process.report?.getReport?.()?.header?.glibcVersionRuntime ?? null, uid: process.getuid?.() });

if (mode === "basic") {
  let seen = false;
  await drain(query({ prompt: `SCENARIO:basic ${args[0] ?? "MARKER_BASIC"}`, options: base }), (m) => {
    if (!seen) { seen = true; out({ claudeProcs: procs().filter((p) => /claude/.test(p.exe + p.cmd)) }); }
  });
}

if (mode === "stream") {
  await drain(query({ prompt: "SCENARIO:stream", options: { ...base, includePartialMessages: true } }), (m) => {
    if (m.type === "stream_event" && m.event.type === "content_block_delta") out({ delta: m.event.delta.text });
  });
}

if (mode === "ping") {
  await drain(query({ prompt: `SCENARIO:ping:${args[0]}`, options: { ...base, includePartialMessages: true } }), (m) => {
    if (m.type === "stream_event") out({ ev: m.event.type });
  });
}

if (mode === "cancel") {
  const ac = new AbortController();
  let fired = false;
  const tAbort = { v: 0 };
  await drain(query({ prompt: "SCENARIO:bash", options: { ...base, abortController: ac } }), async (m) => {
    if (!fired && m.type === "assistant" && m.message.content.some((c) => c.type === "tool_use")) {
      fired = true;
      setTimeout(() => {
        out({ beforeAbort: procs().filter((p) => p.pid !== process.pid && p.pid !== 1) });
        tAbort.v = Date.now();
        ac.abort();
        out({ aborted: true });
      }, 3000);
    }
  });
  out({ generatorEndedAfterAbortMs: Date.now() - tAbort.v });
  for (const w of [0, 1000, 3000, 6000]) {
    await sleep(Math.max(0, tAbort.v + w - Date.now()));
    out({ afterAbortMs: Date.now() - tAbort.v, procs: procs().filter((p) => p.pid !== process.pid && p.pid !== 1) });
  }
}

if (mode === "interrupt") {
  let release;
  const second = new Promise((r) => (release = r));
  async function* input() {
    yield { type: "user", message: { role: "user", content: "SCENARIO:slow MARKER_INT1" }, parent_tool_use_id: null, session_id: "" };
    await second;
    yield { type: "user", message: { role: "user", content: "SCENARIO:recall" }, parent_tool_use_id: null, session_id: "" };
    await new Promise((r) => setTimeout(r, 60000));
  }
  const q = query({ prompt: input(), options: { ...base, includePartialMessages: true } });
  let deltas = 0, interrupted = false, results = 0;
  await drain(q, async (m) => {
    if (m.type === "stream_event" && m.event.type === "content_block_delta" && ++deltas === 3 && !interrupted) {
      interrupted = true;
      const r = await q.interrupt();
      out({ interruptReturned: r ?? null });
      release();
    }
    if (m.type === "result" && ++results === 2) { out({ procsBeforeClose: procs().filter((p) => /claude/.test(p.exe + p.cmd)).length }); q.close(); }
  });
}

if (mode === "close") {
  const q = query({ prompt: "SCENARIO:slow", options: { ...base, includePartialMessages: true } });
  let deltas = 0, tClose = 0;
  await drain(q, async (m) => {
    if (m.type === "stream_event" && m.event.type === "content_block_delta" && ++deltas === 3) {
      out({ before: procs().filter((p) => /claude/.test(p.exe + p.cmd)) });
      tClose = Date.now();
      q.close();
      out({ closed: true });
    }
  });
  out({ generatorEndedAfterCloseMs: Date.now() - tClose });
  for (const w of [0, 3000]) { await sleep(w); out({ afterCloseMs: Date.now() - tClose, procs: procs().filter((p) => p.pid !== process.pid && p.pid !== 1) }); }
}

if (mode === "resume1") {
  const last = await drain(query({ prompt: "SCENARIO:basic MARKER_RESUMEONE", options: base }));
  writeFileSync("/state/sid", last.session_id);
}

if (mode === "resume2" || mode === "fork") {
  const sid = readFileSync("/state/sid", "utf8").trim();
  out({ resumeFrom: sid });
  const last = await drain(query({ prompt: "SCENARIO:recall", options: { ...base, resume: sid, ...(mode === "fork" ? { forkSession: true } : {}) } }));
  out({ sameSession: last?.session_id === sid });
}

if (mode === "nopersist") {
  await drain(query({ prompt: "SCENARIO:basic MARKER_NOPERSIST", options: { ...base, persistSession: false } }));
}

if (mode === "mcpwait") {
  const [waitSec, timeoutSec] = args.map(Number);
  const server = createSdkMcpServer({
    name: "momo",
    ...(timeoutSec ? { timeout: timeoutSec * 1000 } : {}),
    tools: [tool("wait", "Wait for ms milliseconds", { ms: z.number() }, async ({ ms }, extra) => {
      out({ toolStart: ms });
      let aborted = false;
      extra?.signal?.addEventListener?.("abort", () => { aborted = true; out({ toolSignalAborted: true }); });
      await sleep(ms);
      out({ toolEnd: true, aborted });
      return { content: [{ type: "text", text: "waited" }] };
    })],
  });
  await drain(query({ prompt: `SCENARIO:mcpwait:${waitSec}`, options: { ...base, mcpServers: { momo: server } } }));
}

if (mode === "rg") {
  await drain(query({ prompt: "SCENARIO:rg", options: base }));
}

if (mode === "grep") {
  await drain(query({ prompt: "SCENARIO:grep", options: base }));
}

if (mode === "webfetch") {
  await drain(query({ prompt: "SCENARIO:webfetch", options: base }));
}

out({ stderrTail: stderrLines.join("").slice(-1500) });
process.exit(0);
