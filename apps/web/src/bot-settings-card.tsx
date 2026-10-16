import {
  BOT_INSTRUCTIONS_MAX,
  BotModel,
  BotTool,
  type BotModel as BotModelValue,
  type BotTool as BotToolValue,
  type WorkspaceItem,
} from "@momo/contracts";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { BotAvatar } from "@/bot-avatar";

const modelLabel: Record<BotModelValue, string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku" };
const toolLabel: Record<BotToolValue, string> = { memory: "記憶（Memory item）" };

export type CardStatus = "pending" | "saved" | "discarded";

const statusLabel: Record<CardStatus, string> = { pending: "保存待ち", saved: "保存済み", discarded: "破棄" };

export type CardSettings = { model: BotModelValue; tools: BotToolValue[] };

/**
 * The "Bot の設定" card. Every label, the status and the Workspace row are momo's own; only the
 * name and instructions fields come from the Bot, and they are drawn as plain text.
 */
export function BotSettingsCard(props: {
  workspace: WorkspaceItem;
  name: string;
  instructions: string;
  settings: CardSettings;
  status: CardStatus;
  note?: string;
  onSettings?: (settings: CardSettings) => void;
  /** Makes the instructions editable; saving new ones renews the Bot's Sessions. */
  onInstructions?: (instructions: string) => void;
  actions?: ReactNode;
}) {
  const editable = props.onSettings !== undefined;
  const { model, tools } = props.settings;
  const toggle = (tool: BotToolValue, on: boolean) =>
    props.onSettings?.({ model, tools: on ? [...tools, tool] : tools.filter((t) => t !== tool) });

  return (
    <section
      aria-label="Bot の設定"
      data-testid="bot-settings-card"
      className="bg-card w-full max-w-md rounded-xl border p-4 text-sm shadow-sm"
    >
      <header className="mb-3 flex items-center gap-2">
        <BotAvatar name={props.name} size="sm" />
        <b>Bot の設定</b>
        <span data-testid="card-status" className="text-muted-foreground ml-auto text-xs">
          {statusLabel[props.status]}
        </span>
      </header>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2">
        <dt className="text-muted-foreground">名前</dt>
        <dd data-testid="card-name">{props.name}</dd>
        <dt className="text-muted-foreground">指示</dt>
        <dd data-testid="card-instructions" className="whitespace-pre-wrap break-words">
          {props.onInstructions ? (
            <textarea
              aria-label="指示"
              value={props.instructions}
              maxLength={BOT_INSTRUCTIONS_MAX}
              rows={3}
              onChange={(e) => props.onInstructions?.(e.target.value)}
              className="w-full rounded-md border px-2 py-1"
            />
          ) : (
            props.instructions
          )}
        </dd>
        <dt className="text-muted-foreground">モデル</dt>
        <dd>
          {editable ? (
            <select
              aria-label="モデル"
              value={model}
              onChange={(e) => props.onSettings?.({ model: BotModel.parse(e.target.value), tools })}
              className="rounded-md border px-2 py-1"
            >
              {BotModel.options.map((m) => (
                <option key={m} value={m}>
                  {modelLabel[m]}
                </option>
              ))}
            </select>
          ) : (
            modelLabel[model]
          )}
        </dd>
        <dt className="text-muted-foreground">tool</dt>
        <dd className="flex flex-col gap-1">
          {BotTool.options.map((tool) =>
            editable ? (
              <label key={tool} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={tools.includes(tool)}
                  onChange={(e) => toggle(tool, e.target.checked)}
                />
                {toolLabel[tool]}
              </label>
            ) : (
              <span key={tool}>
                {toolLabel[tool]}：{tools.includes(tool) ? "使う" : "使わない"}
              </span>
            ),
          )}
        </dd>
        <dt className="text-muted-foreground">Workspace</dt>
        <dd data-testid="card-workspace">{props.workspace.name}</dd>
      </dl>
      {props.note && (
        <p data-testid="card-note" className="text-muted-foreground my-3 text-xs">
          {props.note}
        </p>
      )}
      {props.actions && <div className="mt-3 flex gap-2">{props.actions}</div>}
    </section>
  );
}

export function SaveDiscard(props: {
  onSave: () => void;
  onDiscard?: () => void;
  busy: boolean;
  saveLabel?: string;
}) {
  return (
    <>
      <Button size="sm" onClick={props.onSave} disabled={props.busy}>
        {props.saveLabel ?? "保存"}
      </Button>
      {props.onDiscard && (
        <Button size="sm" variant="outline" onClick={props.onDiscard} disabled={props.busy}>
          破棄
        </Button>
      )}
    </>
  );
}
