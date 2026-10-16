import type { Status } from "@momo/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, Unauthenticated } from "@/api";

const warningText: Record<Status["warnings"][number]["kind"], string> = {
  filevault_off:
    "FileVault が無効です。Mac のディスクが暗号化されていないため、momo のデータも暗号化されません。",
  time_machine_not_excluded: "データの dir を Time Machine の対象から外せませんでした。",
};

export function HomePage() {
  const [status, setStatus] = useState<Status | "signed_out" | undefined>();

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((error) => {
        if (error instanceof Unauthenticated) setStatus("signed_out");
        else throw error;
      });
  }, []);

  if (status === undefined) return null;
  if (status === "signed_out") return <SignedOut />;

  return (
    <div className="flex min-h-screen flex-col">
      {status.warnings.map((w) => (
        <div key={w.kind} role="alert" className="bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {warningText[w.kind]}
        </div>
      ))}
      <header className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-semibold">momo</span>
        <Link to="/logins" className="text-muted-foreground text-sm hover:underline">
          ログイン中のブラウザ
        </Link>
      </header>
      <main className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        まだ Workspace がありません
      </main>
    </div>
  );
}

export function SignedOut() {
  return (
    <main className="mx-auto max-w-md p-10 text-sm">
      <p>ログインしていません。ターミナルで `momo open` を実行してください。</p>
    </main>
  );
}
