import type { Status, WorkspaceItem } from "@momo/contracts";
import { useEffect, useState } from "react";
import { api, NotFound, Unauthenticated } from "@/api";
import { BotsPane } from "@/bots-pane";
import { WorkspaceShell } from "@/workspace-shell";

type Shell =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | {
      kind: "ready";
      forId: string | undefined;
      status: Status;
      workspaces: WorkspaceItem[];
      current: WorkspaceItem | "missing" | undefined;
    };

/** Loads the shell for one Workspace; a response for a Workspace the page left is dropped. */
function useShell(workspaceId: string | undefined): Shell {
  const [shell, setShell] = useState<Shell>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    const current =
      workspaceId === undefined
        ? Promise.resolve(undefined)
        : api.workspace(workspaceId).catch((error) => {
            if (error instanceof NotFound) return "missing" as const;
            throw error;
          });
    Promise.all([api.status(), api.workspaces(), current])
      .then(([status, list, workspace]) => {
        if (active)
          setShell({
            kind: "ready",
            forId: workspaceId,
            status,
            workspaces: list.workspaces,
            current: workspace,
          });
      })
      .catch((error) => {
        if (!(error instanceof Unauthenticated)) throw error;
        if (active) setShell({ kind: "signed_out" });
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Until the new Workspace loads, show nothing rather than the previous one under the new path.
  if (shell.kind === "ready" && shell.forId !== workspaceId) return { kind: "loading" };
  return shell;
}

export function HomePage() {
  const shell = useShell(undefined);

  if (shell.kind === "loading") return null;
  if (shell.kind === "signed_out") return <SignedOut />;

  return (
    <WorkspaceShell status={shell.status} workspaces={shell.workspaces} current={undefined}>
      <p className="text-muted-foreground m-auto text-sm">
        {shell.workspaces.length === 0
          ? "まだ Workspace がありません。左の ＋ から作れます。"
          : "左のタイルから Workspace を選んでください。"}
      </p>
    </WorkspaceShell>
  );
}

export function WorkspacePage({ workspaceId }: { workspaceId: string }) {
  const shell = useShell(workspaceId);

  if (shell.kind === "loading") return null;
  if (shell.kind === "signed_out") return <SignedOut />;
  if (shell.current === "missing" || shell.current === undefined) {
    return (
      <WorkspaceShell status={shell.status} workspaces={shell.workspaces} current={undefined}>
        <p className="text-muted-foreground m-auto text-sm">この Workspace はありません。</p>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell status={shell.status} workspaces={shell.workspaces} current={shell.current}>
      <BotsPane key={shell.current.id} workspace={shell.current} />
    </WorkspaceShell>
  );
}

export function SignedOut() {
  return (
    <main className="mx-auto max-w-md p-10 text-sm">
      <p>ログインしていません。ターミナルで `momo open` を実行してください。</p>
    </main>
  );
}
