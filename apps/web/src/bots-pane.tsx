import {
  BOT_PURPOSE_MAX,
  DEFAULT_BOT_MODEL,
  DEFAULT_BOT_TOOLS,
  type BotItem,
  type BotSettingsProposal,
  type ConversationItem,
  type WorkspaceItem,
} from "@momo/contracts";
import { useEffect, useState } from "react";
import { api } from "@/api";
import { BotAvatar } from "@/bot-avatar";
import { BotSettingsCard, SaveDiscard, type CardSettings, type CardStatus } from "@/bot-settings-card";
import { BotBubble, ChatFrame, Composer, HumanBubble, useAlive } from "@/chat-parts";
import { ConversationView } from "@/conversation-view";
import { cn } from "@/lib/utils";
import { MemoryList } from "@/memory-list";

type Selection =
  | { kind: "none" }
  | { kind: "create"; attempt: number }
  | { kind: "conversation"; id: string }
  | { kind: "bot"; id: string; from: string };

const timeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" });

/** Mount with `key={workspace.id}` so nothing from the previous Workspace survives a switch. */
export function BotsPane({ workspace }: { workspace: WorkspaceItem }) {
  const [bots, setBots] = useState<BotItem[] | undefined>(undefined);
  const [conversations, setConversations] = useState<ConversationItem[] | undefined>(undefined);
  const [selection, setSelection] = useState<Selection>({ kind: "none" });
  const [failed, setFailed] = useState(false);
  const alive = useAlive();

  useEffect(() => {
    Promise.all([api.bots(workspace.id), api.conversations(workspace.id)]).then(([b, c]) => {
      if (!alive.current) return;
      setBots(b.bots);
      setConversations(c.conversations);
    });
  }, [workspace.id, alive]);

  const startConversation = (bot: BotItem) => {
    setFailed(false);
    api
      .createConversation(workspace.id, { primaryBotId: bot.id })
      .then((conversation) => {
        if (!alive.current) return;
        setConversations((list) => [conversation, ...(list ?? [])]);
        setSelection({ kind: "conversation", id: conversation.id });
      })
      .catch(() => alive.current && setFailed(true));
  };
  const saved = (bot: BotItem) => {
    setBots((list) => [bot, ...(list ?? []).filter((b) => b.id !== bot.id)]);
    startConversation(bot);
  };
  const changed = (bot: BotItem) => setBots((list) => list?.map((b) => (b.id === bot.id ? bot : b)));

  const botOf = (id: string) => bots?.find((b) => b.id === id);
  const selected =
    selection.kind === "conversation" ? conversations?.find((c) => c.id === selection.id) : undefined;
  const selectedBot = selection.kind === "bot" ? botOf(selection.id) : undefined;

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
          {conversations?.map((c) => {
            const bot = botOf(c.primaryBotId);
            const current = selected?.id === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelection({ kind: "conversation", id: c.id })}
                  aria-current={current ? "true" : undefined}
                  className={cn(
                    "hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-2 text-left",
                    current && "bg-muted",
                  )}
                >
                  <BotAvatar name={bot?.name ?? "Bot"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{bot?.name ?? "Bot"}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {timeFormat.format(c.createdAt)} に開始
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {conversations?.length === 0 && (
            <li className="text-muted-foreground p-2 text-xs">右上の ＋ から Bot を作る</li>
          )}
        </ul>
      </aside>
      <section className="flex flex-1 flex-col">
        {selection.kind === "create" ? (
          <CreateBot key={selection.attempt} workspace={workspace} onSaved={saved} />
        ) : selected ? (
          <ConversationView
            key={selected.id}
            workspace={workspace}
            conversation={selected}
            bot={botOf(selected.primaryBotId)}
            actions={
              botOf(selected.primaryBotId) && (
                <ConversationActions
                  onSettings={() =>
                    setSelection({ kind: "bot", id: selected.primaryBotId, from: selected.id })
                  }
                  onNew={() => startConversation(botOf(selected.primaryBotId)!)}
                />
              )
            }
          />
        ) : selectedBot && selection.kind === "bot" ? (
          <BotSettingsView
            key={selectedBot.id}
            workspace={workspace}
            bot={selectedBot}
            onChanged={changed}
            onBack={() => setSelection({ kind: "conversation", id: selection.from })}
            onOpenConversation={(id) => setSelection({ kind: "conversation", id })}
          />
        ) : (
          conversations && (
            <p className="text-muted-foreground m-auto text-sm">
              {conversations.length > 0
                ? "左の一覧か ＋ から会話を始める"
                : "この Workspace にはまだ Bot がいません。左上の ＋ から作る"}
            </p>
          )
        )}
        {failed && <p className="text-destructive p-4 text-sm">会話を始められませんでした。</p>}
      </section>
    </div>
  );
}

function ConversationActions(props: { onSettings: () => void; onNew: () => void }) {
  return (
    <>
      <button type="button" onClick={props.onNew} className="hover:bg-muted rounded-md px-2 py-1 text-xs">
        新しい会話
      </button>
      <button
        type="button"
        onClick={props.onSettings}
        className="hover:bg-muted rounded-md px-2 py-1 text-xs"
      >
        Bot の設定
      </button>
    </>
  );
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
    <ChatFrame
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
    </ChatFrame>
  );
}

function BotSettingsView(props: {
  workspace: WorkspaceItem;
  bot: BotItem;
  onChanged: (bot: BotItem) => void;
  onBack: () => void;
  onOpenConversation: (id: string) => void;
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
    <ChatFrame
      title={props.bot.name}
      actions={
        <button type="button" onClick={props.onBack} className="hover:bg-muted rounded-md px-2 py-1 text-xs">
          会話に戻る
        </button>
      }
    >
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
      <MemoryList workspace={props.workspace} bot={props.bot} onOpenConversation={props.onOpenConversation} />
    </ChatFrame>
  );
}
