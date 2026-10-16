import type { ConversationEvent, MessageItem, SessionItem } from "@momo/contracts";

/** A Run the Bot is still writing; empty text means the typing indicator alone. */
export type Draft = { runId: string; text: string };

export type ConversationState = { messages: MessageItem[]; drafts: Draft[]; sessions: SessionItem[] };

export const emptyConversation: ConversationState = { messages: [], drafts: [], sessions: [] };

export function withMessage(state: ConversationState, message: MessageItem): ConversationState {
  if (state.messages.some((m) => m.id === message.id)) return state;
  const messages = [...state.messages, message].toSorted((a, b) => (a.id < b.id ? -1 : 1));
  const runId = message.author.kind === "bot" ? message.author.runId : undefined;
  return { ...state, messages, drafts: state.drafts.filter((d) => d.runId !== runId) };
}

function withSession(state: ConversationState, session: SessionItem): ConversationState {
  const others = state.sessions.filter((s) => s.id !== session.id);
  return { ...state, sessions: [...others, session].toSorted((a, b) => (a.id < b.id ? -1 : 1)) };
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
    case "session_closed":
      return withSession(state, event.session);
    case "run_queued":
      return state;
  }
}

export type TimelineItem =
  | { kind: "message"; message: MessageItem }
  | { kind: "session_closed"; session: SessionItem };

export function timeline(state: ConversationState): TimelineItem[] {
  const closed = new Map(state.sessions.filter((s) => s.status === "closed").map((s) => [s.id, s]));
  return state.messages.flatMap((message, i): TimelineItem[] => {
    const item: TimelineItem = { kind: "message", message };
    const session = message.sessionId === undefined ? undefined : closed.get(message.sessionId);
    const last = state.messages[i + 1]?.sessionId !== message.sessionId;
    return session && last ? [item, { kind: "session_closed", session }] : [item];
  });
}
