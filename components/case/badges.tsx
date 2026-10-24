import { Badge } from "@/components/ui/badge";
import { maskAccount } from "@/lib/mask";
import { cn } from "@/lib/utils";

export type FieldState = "ai" | "edited" | "confirmed";

/** "AI draft – analyst to verify" until the analyst acts; then "Edited" or "Confirmed". */
export function AiDraftBadge({ state = "ai", label }: { state?: FieldState; label?: string }) {
  if (state === "edited") return <Badge tone="accent">Edited</Badge>;
  if (state === "confirmed") return <Badge tone="ok">Confirmed</Badge>;
  return <Badge tone="ai">{label ?? "AI draft – analyst to verify"}</Badge>;
}

/** Dashed placeholder for values the documents do not state. Never filled with a guess. */
export function MissingValue({ className, hint }: { className?: string; hint?: string }) {
  return (
    <div className={className}>
      <div className="flex h-10 items-center rounded-md border border-dashed border-ai/40 bg-surface px-3 text-[14px] italic text-ai">
        Not provided in documents
      </div>
      {hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

/** Server components pass already-masked values; this only formats. */
export function MaskedAccount({ value, className }: { value: string | null | undefined; className?: string }) {
  const masked = value && value.startsWith("••••") ? value : maskAccount(value);
  if (!masked) return null;
  return <span className={cn("font-mono text-[12.5px] text-muted", className)}>{masked}</span>;
}
