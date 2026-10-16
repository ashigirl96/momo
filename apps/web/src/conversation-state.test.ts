import { describe, expect, test } from "bun:test";
import type { ConversationEvent, MessageItem } from "@momo/contracts";
import { applyEvent, emptyConversation, withMessage } from "./conversation-state.ts";

const owner: MessageItem = {
  id: "message_1",
  conversationId: "conversation_1",
  author: { kind: "owner" },
  text: "こんにちは",
  createdAt: 1,
};
const reply: MessageItem = {
  id: "message_2",
  conversationId: "conversation_1",
  author: { kind: "bot", botId: "bot_1", runId: "run_1" },
  text: "**返事**",
  createdAt: 2,
};

const play = (events: ConversationEvent[], start = emptyConversation) => events.reduce(applyEvent, start);

describe("conversation state", () => {
  test("a started Run shows typing, its deltas build a draft, and its message replaces the draft", () => {
    const typing = play([
      { kind: "message_created", message: owner },
      { kind: "run_started", runId: "run_1" },
    ]);
    expect(typing.drafts).toEqual([{ runId: "run_1", text: "" }]);

    const streaming = play(
      [
        { kind: "run_delta", runId: "run_1", text: "**返" },
        { kind: "run_delta", runId: "run_1", text: "事**" },
      ],
      typing,
    );
    expect(streaming.drafts).toEqual([{ runId: "run_1", text: "**返事**" }]);

    const done = play(
      [
        { kind: "message_created", message: reply },
        { kind: "run_finished", runId: "run_1", status: "completed" },
      ],
      streaming,
    );
    expect(done).toEqual({ messages: [owner, reply], drafts: [] });
  });

  test("a message seen twice, from the POST response and the stream, is shown once", () => {
    const state = applyEvent(withMessage(emptyConversation, owner), {
      kind: "message_created",
      message: owner,
    });

    expect(state.messages).toEqual([owner]);
  });

  test("a Run that ends without a message drops its draft", () => {
    const state = play([
      { kind: "run_started", runId: "run_1" },
      { kind: "run_delta", runId: "run_1", text: "途中" },
      { kind: "run_finished", runId: "run_1", status: "failed" },
    ]);

    expect(state.drafts).toEqual([]);
  });
});
