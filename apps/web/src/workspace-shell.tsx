import { WORKSPACE_NAME_MAX, type Status, type WorkspaceItem } from "@momo/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const warningText: Record<Status["warnings"][number]["kind"], string> = {
  filevault_off:
    "FileVault が無効です。Mac のディスクが暗号化されていないため、momo のデータも暗号化されません。",
  time_machine_not_excluded: "データの dir を Time Machine の対象から外せませんでした。",
};

const tileColors = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-teal-500",
];

function tileColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tileColors[hash % tileColors.length]!;
}

export function WorkspaceShell(props: {
  status: Status;
  workspaces: WorkspaceItem[];
  current: WorkspaceItem | undefined;
  children: ReactNode;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      {props.status.warnings.map((w) => (
        <div key={w.kind} role="alert" className="bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {warningText[w.kind]}
        </div>
      ))}
      <div className="flex flex-1">
        <nav aria-label="Workspace" className="flex w-[60px] flex-col items-center gap-2 bg-neutral-900 py-3">
          {props.workspaces.map((w) => (
            <Link
              key={w.id}
              to="/w/$workspaceId"
              params={{ workspaceId: w.id }}
              title={w.name}
              aria-label={w.name}
              aria-current={w.id === props.current?.id ? "page" : undefined}
              className={cn(
                "flex size-10 items-center justify-center rounded-lg text-base font-semibold text-white",
                tileColor(w.id),
                w.id === props.current?.id ? "ring-2 ring-white" : "opacity-70 hover:opacity-100",
              )}
            >
              {Array.from(w.name)[0]}
            </Link>
          ))}
          <button
            type="button"
            title="Workspace を作る"
            aria-label="Workspace を作る"
            onClick={() => setCreating(true)}
            className="flex size-10 items-center justify-center rounded-lg border border-dashed border-neutral-500 text-xl text-neutral-300 hover:text-white"
          >
            ＋
          </button>
        </nav>
        <div className="flex flex-1 flex-col">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <span className="font-semibold" data-testid="current-workspace">
              {props.current ? props.current.name : "momo"}
            </span>
            <Link to="/logins" className="text-muted-foreground text-sm hover:underline">
              ログイン中のブラウザ
            </Link>
          </header>
          <main className="flex flex-1">{props.children}</main>
        </div>
      </div>
      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    api
      .createWorkspace({ name })
      .then((w) => {
        onClose();
        return navigate({ to: "/w/$workspaceId", params: { workspaceId: w.id } });
      })
      .catch(() => setFailed(true));
  };

  return (
    <div
      role="dialog"
      aria-label="Workspace を作る"
      className="fixed inset-0 flex items-center justify-center bg-black/40"
    >
      <Card className="w-80">
        <CardHeader>
          <CardTitle>Workspace を作る</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <input
              autoFocus
              value={name}
              maxLength={WORKSPACE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="個人、会社 A など"
              aria-label="Workspace の名前"
              className="rounded-md border px-3 py-2 text-sm"
            />
            {failed && <p className="text-destructive text-sm">作れませんでした。名前を確かめてください。</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose}>
                やめる
              </Button>
              <Button type="submit" size="sm" disabled={name.trim() === ""}>
                作る
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
