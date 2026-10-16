import {
  BOT_PURPOSE_MAX,
  DEFAULT_BOT_MODEL,
  DEFAULT_BOT_TOOLS,
  type BotItem,
  type BotSettingsProposal,
  type WorkspaceItem,
} from "@momo/contracts";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/api";
import { BotAvatar } from "@/bot-avatar";
import { BotSettingsCard, SaveDiscard, type CardSettings, type CardStatus } from "@/bot-settings-card";
import { cn } from "@/lib/utils";

type Selection = { kind: "none" } | { kind: "create"; attempt: number } | { kind: "bot"; id: string };

/** Mount with `key={workspace.id}` so nothing from the previous Workspace survives a switch. */
export function BotsPane({ workspace }: { workspace: WorkspaceItem }) {
  const [bots, setBots] = useState<BotItem[] | undefined>(undefined);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const alive = useAlive();

  useEffect(() => {
    api.bots(workspace.id).then((list) => {
      if (alive.current) setBots(list.bots);
    });
  }, [workspace.id, alive]);

  const saved = (bot: BotItem) => {
    setBots((list) => [bot, ...(list ?? []).filter((b) => b.id !== bot.id)]);
    setSelection({ kind: "bot", id: bot.id });
  };
  const changed = (bot: BotItem) => setBots((list) => list?.map((b) => (b.id === bot.id ? bot : b)));

  const selectedBot = selection.kind === "bot" ? bots?.find((b) => b.id === selection.id) : undefined;

  return (
    <div className="flex flex-1">
      <aside aria-label="会話" className="flex w-[280px] flex-col border-r">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="flex-1 truncate text-sm font-medium">{workspace.name}</span>
          <button
            type="button"
            title="新しい Bot を作成"
            aria-label="新しい Bot を作成"
            onClick={() =>
              setSelection((s) => ({ kind: "create", attempt: s.kind === "create" ? s.attempt + 1 : 0 }))
            }
            className="hover:bg-muted flex size-8 items-center justify-center rounded-md text-lg"
          >
            ＋
          </button>
        </div>
        <ul data-testid="conversation-list" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2">
          {bots?.map((bot) => (
            <li key={bot.id}>
              <button
                type="button"
                onClick={() => setSelection({ kind: "bot", id: bot.id })}
                aria-current={selectedBot?.id === bot.id ? "true" : undefined}
                className={cn(
                  "hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-2 text-left",
                  selectedBot?.id === bot.id && "bg-muted",
                )}
              >
                <BotAvatar name={bot.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{bot.name}</span>
                  <span className="text-muted-foreground block truncate text-xs">{bot.instructions}</span>
                </span>
              </button>
            </li>
          ))}
          {bots?.length === 0 && (
            <li className="text-muted-foreground p-2 text-xs">右上の ＋ から Bot を作る</li>
          )}
        </ul>
      </aside>
      <section className="flex flex-1 flex-col">
        {selection.kind === "create" ? (
          <CreateBot key={selection.attempt} workspace={workspace} onSaved={saved} />
        ) : selectedBot ? (
          <BotSettingsView key={selectedBot.id} workspace={workspace} bot={selectedBot} onChanged={changed} />
        ) : (
          bots && (
            <p className="text-muted-foreground m-auto text-sm">
              {bots.length > 0
                ? "左の一覧か ＋ から会話を始める"
                : "この Workspace にはまだ Bot がいません。左上の ＋ から作る"}
            </p>
          )
        )}
      </section>
    </div>
  );
}

function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

type Proposal = BotSettingsProposal & { status: CardStatus; settings: CardSettings };

function CreateBot({ workspace, onSaved }: { workspace: WorkspaceItem; onSaved: (bot: BotItem) => void }) {
  const [purposes, setPurposes] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useAlive();

  const ask = (purpose: string) => {
    setPurposes((p) => [...p, purpose]);
    setBusy(true);
    setFailed(false);
    api
      .proposeBot(workspace.id, { purpose })
      .then((p) => {
        if (alive.current)
          setProposal({
            ...p,
            status: "pending",
            settings: { model: DEFAULT_BOT_MODEL, tools: DEFAULT_BOT_TOOLS },
          });
      })
      .catch(() => alive.current && setFailed(true))
      .finally(() => alive.current && setBusy(false));
  };

  const save = () => {
    if (!proposal) return;
    setBusy(true);
    api
      .createBot(workspace.id, {
        name: proposal.name,
        instructions: proposal.instructions,
        ...proposal.settings,
      })
      .then((bot) => alive.current && onSaved(bot))
      .catch(() => alive.current && setFailed(true))
      .finally(() => alive.current && setBusy(false));
  };

  const open = proposal?.status === "pending";

  return (
    <Conversation
      title="新しい Bot"
      composer={
        <Composer
          placeholder="新しい Bot にメッセージ"
          disabled={busy || open}
          maxLength={BOT_PURPOSE_MAX}
          onSend={ask}
        />
      }
    >
      <BotBubble>まず、どんなことで一番手伝ってほしいですか？</BotBubble>
      {purposes.map((p, i) => (
        <HumanBubble key={i}>{p}</HumanBubble>
      ))}
      {proposal && (
        <BotSettingsCard
          workspace={workspace}
          name={proposal.name}
          instructions={proposal.instructions}
          settings={proposal.settings}
          status={proposal.status}
          note="Bot が書いた案です。保存すると指示になります。外部のアプリを使わせるかは、これとは別にカードで決めます。"
          onSettings={open ? (settings) => setProposal({ ...proposal, settings }) : undefined}
          actions={
            open && (
              <SaveDiscard
                busy={busy}
                onSave={save}
                onDiscard={() => setProposal({ ...proposal, status: "discarded" })}
              />
            )
          }
        />
      )}
      {proposal?.status === "discarded" && (
        <BotBubble>わかりました。どんな Bot にしたいか、もう一度教えてください。</BotBubble>
      )}
      {failed && <p className="text-destructive text-sm">うまくいきませんでした。もう一度試してください。</p>}
    </Conversation>
  );
}

function BotSettingsView(props: {
  workspace: WorkspaceItem;
  bot: BotItem;
  onChanged: (bot: BotItem) => void;
}) {
  const [settings, setSettings] = useState<CardSettings>({ model: props.bot.model, tools: props.bot.tools });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useAlive();
  const dirty =
    settings.model !== props.bot.model ||
    settings.tools.length !== props.bot.tools.length ||
    settings.tools.some((t) => !props.bot.tools.includes(t));

  const save = () => {
    setBusy(true);
    setFailed(false);
    api
      .updateBot(props.workspace.id, props.bot.id, settings)
      .then((bot) => alive.current && props.onChanged(bot))
      .catch(() => alive.current && setFailed(true))
      .finally(() => alive.current && setBusy(false));
  };

  return (
    <Conversation title={props.bot.name}>
      <BotSettingsCard
        workspace={props.workspace}
        name={props.bot.name}
        instructions={props.bot.instructions}
        settings={settings}
        status={dirty ? "pending" : "saved"}
        onSettings={setSettings}
        actions={dirty && <SaveDiscard busy={busy} onSave={save} saveLabel="変更を保存" />}
      />
      {failed && <p className="text-destructive text-sm">保存できませんでした。</p>}
    </Conversation>
  );
}

function Conversation(props: { title: string; children: ReactNode; composer?: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <BotAvatar name={props.title} size="sm" />
        <span className="text-sm font-medium" data-testid="conversation-title">
          {props.title}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">{props.children}</div>
      {props.composer}
    </>
  );
}

function BotBubble({ children }: { children: ReactNode }) {
  return <div className="bg-muted max-w-[70%] self-start rounded-2xl px-3 py-2 text-sm">{children}</div>;
}

function HumanBubble({ children }: { children: ReactNode }) {
  return (
    <div className="bg-primary text-primary-foreground max-w-[70%] self-end whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm">
      {children}
    </div>
  );
}

function Composer(props: {
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
