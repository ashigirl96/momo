import { cn } from "@/lib/utils";

export function BotAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-neutral-700 font-semibold text-white",
        size === "sm" ? "size-6 text-xs" : "size-9 text-sm",
      )}
    >
      {Array.from(name)[0] ?? "?"}
    </span>
  );
}
