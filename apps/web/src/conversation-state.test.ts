import { describe, expect, test } from "bun:test";
import { ConversationEvent, type MessageItem, type SessionItem } from "@momo/contracts";
import { applyEvent, emptyConversation, timeline, withMessage } from "./conversation-state.ts";

const owner: MessageItem = {
  id: "message_1",
  conversationId: "conversation_1",
  author: { kind: "owner" },
  sessionId: "session_1",
  text: "こんにちは",
  attachments: [],
  createdAt: 1,
};
const reply: MessageItem = {
  id: "message_2",
  conversationId: "conversation_1",
  author: { kind: "bot", botId: "bot_1", runId: "run_1", cancelled: false },
  sessionId: "session_1",
  text: "**返事**",
  attachments: [],
  createdAt: 2,
};
const afterReset: MessageItem = { ...owner, id: "message_3", sessionId: "session_2", text: "続き" };
const session: SessionItem = {
  id: "session_1",
  conversationId: "conversation_1",
  botId: "bot_1",
  status: "open",
  botInstructionsVersion: 1,
  openedAt: 1,
};
const closed: SessionItem = { ...session, status: "closed", closedAt: 3, closedBy: "reset" };

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
    expect(done).toEqual({ messages: [owner, reply], drafts: [], sessions: [] });
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

  test("a message event logged before Sessions could be renewed still parses and draws no divider", () => {
    const old = ConversationEvent.parse({
      kind: "message_created",
      message: {
        id: "message_9",
        conversationId: "conversation_1",
        author: { kind: "bot", botId: "bot_1", runId: "run_9" },
        text: "前の返事",
        createdAt: 1,
      },
    });
    const state = play([old], { ...emptyConversation, sessions: [closed] });

    expect(state.messages[0]?.author).toEqual({
      kind: "bot",
      botId: "bot_1",
      runId: "run_9",
      cancelled: false,
    });
    expect(timeline(state).map((i) => i.kind)).toEqual(["message"]);
  });

  test("a closed Session draws a divider after its last message, live and after a reload alike", () => {
    const live = play([{ kind: "session_closed", session: closed }], {
      ...emptyConversation,
      messages: [owner, reply],
      sessions: [session],
    });
    const reloaded = { ...emptyConversation, messages: [owner, reply, afterReset], sessions: [closed] };

    expect(timeline(live).map((i) => i.kind)).toEqual(["message", "message", "session_closed"]);
    expect(timeline(withMessage(live, afterReset))).toEqual(timeline(reloaded));
    expect(timeline(reloaded)).toEqual([
      { kind: "message", message: owner },
      { kind: "message", message: reply },
      { kind: "session_closed", session: closed },
      { kind: "message", message: afterReset },
    ]);
  });
});
