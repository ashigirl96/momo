import type { ConversationEvent, MessageItem } from "@momo/contracts";

/** A Run the Bot is still writing; empty text means the typing indicator alone. */
export type Draft = { runId: string; text: string };

export type ConversationState = { messages: MessageItem[]; drafts: Draft[] };

export const emptyConversation: ConversationState = { messages: [], drafts: [] };

export function withMessage(state: ConversationState, message: MessageItem): ConversationState {
  if (state.messages.some((m) => m.id === message.id)) return state;
  const messages = [...state.messages, message].toSorted((a, b) => (a.id < b.id ? -1 : 1));
  const runId = message.author.kind === "bot" ? message.author.runId : undefined;
  return { messages, drafts: state.drafts.filter((d) => d.runId !== runId) };
}

export function applyEvent(state: ConversationState, event: ConversationEvent): ConversationState {
  switch (event.kind) {
    case "message_created":
      return withMessage(state, event.message);
    case "run_started":
      if (state.drafts.some((d) => d.runId === event.runId)) return state;
      return { ...state, drafts: [...state.drafts, { runId: event.runId, text: "" }] };
    case "run_delta": {
      const drafts = state.drafts.some((d) => d.runId === event.runId)
        ? state.drafts
        : [...state.drafts, { runId: event.runId, text: "" }];
      return {
        ...state,
        drafts: drafts.map((d) => (d.runId === event.runId ? { ...d, text: d.text + event.text } : d)),
      };
    }
    case "run_finished":
      return { ...state, drafts: state.drafts.filter((d) => d.runId !== event.runId) };
    case "run_queued":
      return state;
  }
}
