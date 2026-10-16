import type { LoginItem } from "@momo/contracts";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { api, Unauthenticated } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignedOut } from "./home";

const formatDate = (ms: number) => new Date(ms).toLocaleString("ja-JP");

export function LoginsPage() {
  const [logins, setLogins] = useState<LoginItem[] | "signed_out" | undefined>();

  const load = useCallback(() => {
    api
      .logins()
      .then((list) => setLogins(list.logins))
      .catch((error) => {
        if (error instanceof Unauthenticated) setLogins("signed_out");
        else throw error;
      });
  }, []);

  useEffect(load, [load]);

  if (logins === undefined) return null;
  if (logins === "signed_out") return <SignedOut />;

  const revoke = (login: LoginItem) => {
    api.revokeLogin(login.id).then(login.current ? () => setLogins("signed_out") : load);
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-6">
      <Link to="/" className="text-muted-foreground text-sm hover:underline">
        ← 戻る
      </Link>
      <h1 className="text-lg font-semibold">ログイン中のブラウザ</h1>
      {logins.map((login) => (
        <Card key={login.id}>
          <CardHeader>
            <CardTitle>{login.current ? "このブラウザ" : login.userAgent || "不明なブラウザ"}</CardTitle>
            <CardDescription>
              {login.current && <span className="block">{login.userAgent}</span>}
              ログイン {formatDate(login.createdAt)} ・ 最終利用 {formatDate(login.lastUsedAt)} ・ 期限{" "}
              {formatDate(login.expiresAt)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={() => revoke(login)}>
              取り消す
            </Button>
          </CardContent>
        </Card>
      ))}
    </main>
  );
}
