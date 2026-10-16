import {
  ATTACHMENTS_PER_MESSAGE_MAX,
  ConversationEvent,
  MESSAGE_TEXT_MAX,
  type BotItem,
  type ConversationItem,
  type MessageItem,
  type SessionCloseReason,
  type SessionItem,
  type WorkspaceItem,
} from "@momo/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/api";
import { AttachmentFrame } from "@/attachment-frame";
import { BotBubble, ChatFrame, Composer, HumanBubble, useAlive } from "@/chat-parts";
import {
  applyEvent,
  emptyConversation,
  timeline,
  withMessage,
  type ConversationState,
} from "@/conversation-state";
import { MessageText } from "@/message-text";

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Loads the history, then follows the Conversation's SSE stream from where the history ends.
 * Everything is dropped when the Workspace or Conversation changes, so a late answer from the
 * previous one never lands here.
 */
function useConversation(workspaceId: string, conversationId: string) {
  const [state, setState] = useState<ConversationState | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const left = new AbortController();
    let source: EventSource | undefined;
    (async () => {
      let page = await api.messages(workspaceId, conversationId);
      const streamAfter = page.streamAfter;
      let loaded = page.messages.reduce(withMessage, { ...emptyConversation, sessions: page.sessions });
      while (page.nextCursor && !left.signal.aborted) {
        page = await api.messages(workspaceId, conversationId, page.nextCursor);
        loaded = page.messages.reduce(withMessage, { ...loaded, sessions: page.sessions });
      }
      if (left.signal.aborted) return;
      setState(loaded);
      source = api.conversationEvents(workspaceId, conversationId, streamAfter);
      source.addEventListener("message", (frame) => {
        if (left.signal.aborted) return;
        const event = ConversationEvent.safeParse(parseJson(frame.data));
        if (event.success) setState((s) => s && applyEvent(s, event.data));
      });
    })().catch(() => !left.signal.aborted && setFailed(true));
    return () => {
      left.abort();
      source?.close();
    };
  }, [workspaceId, conversationId]);

  const add = (message: MessageItem) => setState((s) => s && withMessage(s, message));
  return { state, failed, add };
}

const closedLabel: Record<SessionCloseReason, string> = {
  reset: "ここで Session をリセットしました。この先は新しい Session です。",
  instructions_changed: "Bot の指示が変わったので、この先は新しい Session です。",
};

/** momo's own marker; the earlier messages above it stay as they were and are read-only. */
function SessionDivider({ session }: { session: SessionItem }) {
  return (
    <div
      role="separator"
      data-testid="session-divider"
      className="text-muted-foreground flex items-center gap-2 text-xs"
    >
      <span className="h-px flex-1 bg-current opacity-30" />
      {session.closedBy && closedLabel[session.closedBy]}
      <span className="h-px flex-1 bg-current opacity-30" />
    </div>
  );
}

export function ConversationView(props: {
  workspace: WorkspaceItem;
  conversation: ConversationItem;
  bot: BotItem | undefined;
  actions?: ReactNode;
}) {
  const { state, failed, add } = useConversation(props.workspace.id, props.conversation.id);
  const [sendFailed, setSendFailed] = useState(false);
  const alive = useAlive();
  const name = props.bot?.name ?? "Bot";

  const send = (text: string, files: File[]) => {
    setSendFailed(false);
    const sending =
      files.length === 0
        ? api.postMessage(props.workspace.id, props.conversation.id, { text })
        : api.postMessageWithFiles(props.workspace.id, props.conversation.id, text, files);
    sending
      .then((posted) => alive.current && add(posted.message))
      .catch(() => alive.current && setSendFailed(true));
  };

  /** The outcome arrives on the stream, so only a failed request is drawn here. */
  const act = (request: Promise<unknown>) => {
    setSendFailed(false);
    request.catch(() => alive.current && setSendFailed(true));
  };
  const cancel = (runId: string) => act(api.cancelRun(props.workspace.id, runId));
  const reset = () => act(api.resetSession(props.workspace.id, props.conversation.id));

  return (
    <ChatFrame
      title={name}
      actions={
        <>
          <button
            type="button"
            onClick={reset}
            disabled={!state}
            data-testid="reset-session"
            title="Bot の文脈を消して、新しい Session で続けます。これまでの発言は残ります。"
            className="hover:bg-muted rounded-md px-2 py-1 text-xs"
          >
            リセット
          </button>
          {props.actions}
        </>
      }
      composer={
        <Composer
          placeholder={`${name}にメッセージ`}
          disabled={!state}
          maxLength={MESSAGE_TEXT_MAX}
          maxFiles={ATTACHMENTS_PER_MESSAGE_MAX}
          onSend={send}
        />
      }
    >
      {state &&
        timeline(state).map((item) => {
          if (item.kind === "session_closed")
            return <SessionDivider key={`closed-${item.session.id}`} session={item.session} />;
          const m = item.message;
          return m.author.kind === "owner" ? (
            <HumanBubble key={m.id} testId="owner-message">
              {m.text && <MessageText text={m.text} />}
              {m.attachments.map((a) => (
                <AttachmentFrame
                  key={a.id}
                  attachment={a}
                  src={api.attachmentUrl(props.workspace.id, props.conversation.id, a.id)}
                />
              ))}
            </HumanBubble>
          ) : (
            <BotBubble key={m.id} testId="bot-message">
              <MessageText text={m.text} />
              {m.author.cancelled && (
                <span data-testid="cancelled-mark" className="text-muted-foreground block text-xs">
                  途中で止めました
                </span>
              )}
            </BotBubble>
          );
        })}
      {state?.drafts.map((d) => (
        <BotBubble key={d.runId} testId="bot-draft">
          {d.text && <MessageText text={d.text} />}
          <span className="flex items-center gap-2">
            <span data-testid="typing" className="text-muted-foreground text-xs">
              {name}が入力中…
            </span>
            <button
              type="button"
              onClick={() => cancel(d.runId)}
              data-testid="cancel-run"
              className="hover:bg-background rounded-md border px-2 text-xs"
            >
              止める
            </button>
          </span>
        </BotBubble>
      ))}
      {state?.messages.length === 0 && state.drafts.length === 0 && (
        <p className="text-muted-foreground m-auto text-sm">{name}に話しかけてみましょう</p>
      )}
      {(failed || sendFailed) && (
        <p className="text-destructive text-sm">うまくいきませんでした。もう一度試してください。</p>
      )}
    </ChatFrame>
  );
}
