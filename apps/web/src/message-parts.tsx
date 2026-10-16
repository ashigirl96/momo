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

export function MessageFrame(props: {
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
  /** Lets the owner attach up to this many files; the text may then be empty. */
  maxFiles?: number;
  onSend: (text: string, files: File[]) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const empty = text.trim() === "" && files.length === 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (empty) return;
    props.onSend(text.trim(), files);
    setText("");
    setFiles([]);
  };
  const pick = (picked: FileList | null) => {
    setFiles((current) => [...current, ...(picked ?? [])].slice(0, props.maxFiles));
    if (picker.current) picker.current.value = "";
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t p-3">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid="picked-files">
          {files.map((file, i) => (
            <li
              key={`${i}-${file.name}`}
              className="bg-muted flex items-center gap-1 rounded-full px-3 py-1 text-xs"
            >
              {file.name}
              <button
                type="button"
                aria-label={`${file.name} を外す`}
                onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        {props.maxFiles !== undefined && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              data-testid="file-picker"
              onChange={(e) => pick(e.target.files)}
            />
            <button
              type="button"
              aria-label="ファイルを添付"
              disabled={props.disabled || files.length >= props.maxFiles}
              onClick={() => picker.current?.click()}
              className="flex size-9 items-center justify-center rounded-full border disabled:opacity-40"
            >
              ＋
            </button>
          </>
        )}
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
          disabled={props.disabled || empty}
          className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-full disabled:opacity-40"
        >
          ↑
        </button>
      </div>
    </form>
  );
}
