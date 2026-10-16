import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BotAvatar } from "@/bot-avatar";

/** False once the component unmounted, so a late response is dropped instead of drawn. */
export function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

export function ChatFrame(props: {
  title: string;
  children: ReactNode;
  composer?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <BotAvatar name={props.title} size="sm" />
        <span className="flex-1 text-sm font-medium" data-testid="conversation-title">
          {props.title}
        </span>
        {props.actions}
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" data-testid="messages">
        {props.children}
      </div>
      {props.composer}
    </>
  );
}

export function BotBubble({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="bg-muted max-w-[70%] self-start rounded-2xl px-3 py-2 text-sm">
      {children}
    </div>
  );
}

export function HumanBubble({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className="bg-primary text-primary-foreground max-w-[70%] self-end whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
    >
      {children}
    </div>
  );
}

export function Composer(props: {
  placeholder: string;
  disabled: boolean;
  maxLength: number;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() === "") return;
    props.onSend(text.trim());
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2 border-t p-3">
      <input
        autoFocus
        value={text}
        maxLength={props.maxLength}
        onChange={(e) => setText(e.target.value)}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        disabled={props.disabled}
        className="flex-1 rounded-full border px-4 py-2 text-sm"
      />
      <button
        type="submit"
        aria-label="送る"
        disabled={props.disabled || text.trim() === ""}
        className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full disabled:opacity-40"
      >
        ↑
      </button>
    </form>
  );
}
