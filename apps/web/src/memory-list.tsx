import type { BotItem, MemoryItem, MemoryProvenance, WorkspaceItem } from "@momo/contracts";
import { useEffect, useState } from "react";
import { api, NotFound } from "@/api";
import { useAlive } from "@/chat-parts";

const timeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" });

function Source(props: { provenance: MemoryProvenance; onOpenConversation: (id: string) => void }) {
  const p = props.provenance;
  if (p.writer === "owner") return <span>所有者が書いた</span>;
  if (p.source.kind === "deleted_conversation") return <span>消した会話</span>;
  const { conversationId } = p.source;
  return (
    <button type="button" className="underline" onClick={() => props.onOpenConversation(conversationId)}>
      会話を開く
    </button>
  );
}

/** The Bot's Memory items as the owner reviews them. Every field the Bot wrote is drawn as plain text. */
export function MemoryList(props: {
  workspace: WorkspaceItem;
  bot: BotItem;
  onOpenConversation: (id: string) => void;
}) {
  const [items, setItems] = useState<MemoryItem[] | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const alive = useAlive();
  const { workspace, bot } = props;

  useEffect(() => {
    api
      .memory(workspace.id, bot.id)
      .then((page) => {
        if (!alive.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => alive.current && setFailed(true));
  }, [workspace.id, bot.id, alive]);

  const more = () => {
    api.memory(workspace.id, bot.id, nextCursor).then((page) => {
      if (!alive.current) return;
      setItems((list) => [...(list ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    });
  };

  const remove = (id: string) => {
    setDeleting(id);
    setFailed(false);
    api
      .deleteMemory(workspace.id, bot.id, id)
      .catch((error) => {
        if (!(error instanceof NotFound)) throw error;
      })
      .then(() => alive.current && setItems((list) => list?.filter((item) => item.id !== id)))
      .catch(() => alive.current && setFailed(true))
      .finally(() => alive.current && setDeleting(undefined));
  };

  return (
    <section aria-label="記憶" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">記憶</h2>
      <p className="text-muted-foreground text-xs">
        {bot.name}が会話で書いた記憶です。消すと元に戻せず、検索にもすぐ出なくなります。
      </p>
      <ul data-testid="memory-list" className="flex flex-col gap-2">
        {items?.map((item) => (
          <li key={item.id} data-testid="memory-item" className="rounded-md border p-3 text-sm">
            <div className="flex items-start gap-2">
              <span className="flex-1 font-medium break-words">{item.title}</span>
              <button
                type="button"
                data-testid="memory-delete"
                disabled={deleting === item.id}
                onClick={() => remove(item.id)}
                className="hover:bg-muted text-destructive rounded-md px-2 py-1 text-xs"
              >
                消す
              </button>
            </div>
            {item.description && <p className="text-muted-foreground text-xs">{item.description}</p>}
            <p className="mt-1 whitespace-pre-wrap break-words">{item.body}</p>
            <dl className="text-muted-foreground mt-2 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
              <dt>種類</dt>
              <dd>{item.type}</dd>
              {item.tags.length > 0 && (
                <>
                  <dt>タグ</dt>
                  <dd>{item.tags.join("、")}</dd>
                </>
              )}
              {item.resource && (
                <>
                  <dt>元の内容（Bot の申告）</dt>
                  <dd className="break-all">{item.resource}</dd>
                </>
              )}
              <dt>出典</dt>
              <dd data-testid="memory-source">
                <Source provenance={item.created} onOpenConversation={props.onOpenConversation} />
              </dd>
              <dt>更新</dt>
              <dd>{timeFormat.format(item.updatedAt)}</dd>
            </dl>
          </li>
        ))}
        {items?.length === 0 && <li className="text-muted-foreground text-xs">まだ記憶はありません。</li>}
      </ul>
      {nextCursor && (
        <button
          type="button"
          onClick={more}
          className="hover:bg-muted self-start rounded-md px-2 py-1 text-xs"
        >
          もっと見る
        </button>
      )}
      {failed && <p className="text-destructive text-sm">記憶を読み込めないか、消せませんでした。</p>}
    </section>
  );
}
