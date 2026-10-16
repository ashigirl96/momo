import { afterEach, describe, expect, test } from "bun:test";
import { RunnerOutbound, type RunnerInbound } from "@momo/contracts";
import { fakeReply, FakeRunner } from "./fake-runner.ts";
import { SessionMailbox } from "./mailbox.ts";

let runner: FakeRunner;

afterEach(() => runner.stop());

function connect(delayMs: number) {
  runner = new FakeRunner({ delayMs });
  const mailbox = new SessionMailbox();
  runner.attach(mailbox);
  const outbound: RunnerOutbound[] = [];
  const done = Promise.withResolvers<void>();
  mailbox.onOutbound((message) => {
    outbound.push(RunnerOutbound.parse(message));
    if ((message as RunnerOutbound).kind === "run_finished") done.resolve();
  });
  return { send: (message: RunnerInbound) => mailbox.postInbound(message), outbound, done: done.promise };
}

const text = (outbound: RunnerOutbound[]) =>
  outbound.map((m) => (m.kind === "stream_delta" ? m.text : "")).join("");

describe("fake runner over the Session mailbox", () => {
  test("streams a fixed reply to a Run start in several deltas, then finishes the Run", async () => {
    const { send, outbound, done } = connect(0);
    send({ kind: "run_start", runId: "run_1", input: "旅行の計画", history: [] });
    await done;

    expect(text(outbound)).toBe(fakeReply("旅行の計画", []));
    expect(fakeReply("旅行の計画", [])).toContain("旅行の計画");
    expect(outbound.filter((m) => m.kind === "stream_delta").length).toBeGreaterThan(1);
    expect(outbound.every((m) => m.runId === "run_1")).toBe(true);
    expect(outbound.at(-1)).toEqual({ kind: "run_finished", runId: "run_1", outcome: "completed" });
  });

  test("the reply depends on how many messages the Conversation already has", () => {
    expect(
      fakeReply("2", [
        { author: "owner", text: "1" },
        { author: "bot", text: "返事" },
      ]),
    ).not.toBe(fakeReply("2", []));
  });

  test("a cancel stops the stream and finishes the Run as cancelled", async () => {
    const { send, outbound, done } = connect(20);
    send({ kind: "run_start", runId: "run_1", input: "長い返事".repeat(20), history: [] });
    await Bun.sleep(30);
    send({ kind: "cancel", runId: "run_1" });
    await done;
    const deltas = outbound.filter((m) => m.kind === "stream_delta").length;
    await Bun.sleep(60);

    expect(outbound.at(-1)).toEqual({ kind: "run_finished", runId: "run_1", outcome: "cancelled" });
    expect(outbound.filter((m) => m.kind === "stream_delta")).toHaveLength(deltas);
    expect(text(outbound).length).toBeLessThan(fakeReply("長い返事".repeat(20), []).length);
  });

  test("`remember:` asks for the memory write tool in the Run, then answers with its result", async () => {
    const { send, outbound, done } = connect(0);
    send({ kind: "run_start", runId: "run_1", input: "remember: 朝はコーヒーを飲む", history: [] });
    await Bun.sleep(10);

    const request = outbound.find((m) => m.kind === "tool_request");
    expect(request).toMatchObject({
      runId: "run_1",
      tool: { kind: "memory_write", item: { body: "朝はコーヒーを飲む", title: "朝はコーヒーを飲む" } },
    });
    expect(outbound.filter((m) => m.kind === "stream_delta")).toEqual([]);

    send({
      kind: "tool_result",
      runId: "run_1",
      requestId: request!.requestId,
      result: { kind: "memory_written", id: "memory_1" },
    });
    await done;
    expect(text(outbound)).toBe("覚えました: 朝はコーヒーを飲む");
  });

  test("`recall:` asks for the memory search tool and lists what it found", async () => {
    const { send, outbound, done } = connect(0);
    send({ kind: "run_start", runId: "run_1", input: "recall: コーヒー", history: [] });
    await Bun.sleep(10);
    const request = outbound.find((m) => m.kind === "tool_request");
    expect(request?.tool).toEqual({ kind: "memory_search", query: "コーヒー" });

    send({
      kind: "tool_result",
      runId: "run_1",
      requestId: request!.requestId,
      result: {
        kind: "memory_found",
        items: [
          { id: "memory_1", type: "note", title: "朝", description: "", tags: [], body: "朝はコーヒー" },
        ],
      },
    });
    await done;
    expect(text(outbound)).toBe("見つけた記憶:\n- 朝はコーヒー");
  });

  test("a tool error is told in the reply", async () => {
    const { send, outbound, done } = connect(0);
    send({ kind: "run_start", runId: "run_1", input: "recall: 何か", history: [] });
    await Bun.sleep(10);
    const request = outbound.find((m) => m.kind === "tool_request")!;
    send({
      kind: "tool_result",
      runId: "run_1",
      requestId: request.requestId,
      result: { kind: "error", error: "failed", message: "down" },
    });
    await done;
    expect(text(outbound)).toBe("記憶の tool が失敗しました: down");
  });

  test("an inbound message that fails the wire schema is ignored", async () => {
    const { outbound } = connect(0);
    const mailbox = new SessionMailbox();
    runner.attach(mailbox);
    mailbox.postInbound({ kind: "run_start", runId: "run_1" } as unknown as RunnerInbound);
    await Bun.sleep(10);

    expect(outbound).toEqual([]);
  });
});
