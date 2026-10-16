import {
  ATTACHMENTS_PER_MESSAGE_MAX,
  ConversationEvent,
  MESSAGE_TEXT_MAX,
  type BotItem,
  type ConversationItem,
  type MessageItem,
  type WorkspaceItem,
} from "@momo/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/api";
import { AttachmentFrame } from "@/attachment-frame";
import { BotBubble, ChatFrame, Composer, HumanBubble, useAlive } from "@/chat-parts";
import { applyEvent, emptyConversation, withMessage, type ConversationState } from "@/conversation-state";
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
      let loaded = page.messages.reduce(withMessage, emptyConversation);
      while (page.nextCursor && !left.signal.aborted) {
        page = await api.messages(workspaceId, conversationId, page.nextCursor);
        loaded = page.messages.reduce(withMessage, loaded);
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

  return (
    <ChatFrame
      title={name}
      actions={props.actions}
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
      {state?.messages.map((m) =>
        m.author.kind === "owner" ? (
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
          </BotBubble>
        ),
      )}
      {state?.drafts.map((d) => (
        <BotBubble key={d.runId} testId="bot-draft">
          {d.text && <MessageText text={d.text} />}
          <span data-testid="typing" className="text-muted-foreground text-xs">
            {name}が入力中…
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
