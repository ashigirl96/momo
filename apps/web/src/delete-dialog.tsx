import type { DeletionPreview } from "@momo/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAlive } from "@/chat-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Asks before a deletion that cannot be undone, with the number of Conversations it takes.
 * The delete button stays off until that number has loaded.
 */
export function DeleteDialog(props: {
  title: string;
  preview: () => Promise<DeletionPreview>;
  describe: (preview: DeletionPreview) => ReactNode;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const load = useRef(props.preview);
  const [preview, setPreview] = useState<DeletionPreview | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useAlive();

  useEffect(() => {
    load
      .current()
      .then((p) => alive.current && setPreview(p))
      .catch(() => alive.current && setFailed(true));
  }, [alive]);

  const confirm = () => {
    setBusy(true);
    setFailed(false);
    props
      .onDelete()
      .catch(() => alive.current && setFailed(true))
      .finally(() => alive.current && setBusy(false));
  };

  return (
    <div
      role="dialog"
      aria-label={props.title}
      data-testid="delete-dialog"
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40"
    >
      <Card className="w-96">
        <CardHeader>
          <CardTitle>{props.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {preview ? (
            <>
              <p>
                消える会話: <strong data-testid="deletion-count">{preview.conversations}</strong> 件
              </p>
              <p>{props.describe(preview)}</p>
              <p className="text-destructive">元に戻せません。</p>
            </>
          ) : (
            !failed && <p className="text-muted-foreground">消えるものを数えています…</p>
          )}
          {failed && <p className="text-destructive">消せませんでした。</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={props.onClose}>
              やめる
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid="confirm-delete"
              disabled={!preview || busy}
              onClick={confirm}
            >
              消す
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
