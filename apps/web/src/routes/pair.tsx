import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api } from "@/api";

function takePairingToken(): string {
  const token = window.location.hash.slice(1);
  window.history.replaceState(null, "", window.location.pathname);
  return token;
}

export function PairPage() {
  const navigate = useNavigate();
  const [token] = useState(takePairingToken);
  const [failed, setFailed] = useState(token === "");

  useEffect(() => {
    if (token === "") return;
    api
      .pair({ token })
      .then(() => navigate({ to: "/", replace: true }))
      .catch(() => setFailed(true));
  }, [token, navigate]);

  return (
    <main className="mx-auto max-w-md p-10 text-sm">
      {failed ? (
        <p>このリンクは使えません。ターミナルでもう一度 `momo open` を実行してください。</p>
      ) : (
        <p>ログインしています…</p>
      )}
    </main>
  );
}
