"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { AiDraftBadge } from "@/components/case/badges";
import { SourceChip } from "@/components/case/document-preview";
import { useSave } from "@/components/case/save-status";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export type Q5View = {
  counterpartyId: number;
  rank: number;
  name: string;
  summary: {
    id: number;
    relationshipType: string;
    relationshipSubtype: string | null;
    kycFit: "fits" | "partial" | "does_not_fit";
    aiText: string;
    analystText: string | null;
    sources: string[];
    reviewStatus: "agree" | "edited" | "needs_rfi" | null;
  } | null;
};

const REL: Record<string, string> = {
  supplier: "Supplier",
  customer: "Customer",
  related_party: "Related party",
  group_company: "Group company",
  individual: "Individual",
  unknown: "Unknown",
};
const FIT = { fits: ["Fits KYC", "text-ok"], partial: ["Partial KYC fit", "text-ai"], does_not_fit: ["Does not fit KYC", "text-risk"] } as const;

export function Q5Cards({ caseId, items, readOnly }: { caseId: number; items: Q5View[]; readOnly: boolean }) {
  const router = useRouter();
  const track = useSave();
  const [showAll, setShowAll] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const missing = items.filter((i) => !i.summary).length;
  const reviewed = items.filter((i) => i.summary?.reviewStatus).length;
  const rfi = items.filter((i) => i.summary?.reviewStatus === "needs_rfi").length;
  const visible = showAll ? items : items.slice(0, 3);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await track(api(`/api/cases/${caseId}/summaries`, { body: {} }));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader
        title="Q5 · Relationship and purpose"
        aside={
          <span className="text-[12.5px] text-muted">
            {reviewed} of {items.length} reviewed{rfi ? ` · ${rfi} needs RFI` : ""}
          </span>
        }
      />
      {items.length === 0 ? (
        <p className="text-[14px] text-muted">The top 6 counterparties appear here once the transactions are analysed (screen 2).</p>
      ) : null}
      {missing > 0 && !readOnly ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-accent-soft px-4 py-3 text-[13.5px]">
          <span>{missing} counterpart{missing === 1 ? "y has" : "ies have"} no summary yet.</span>
          <Button variant="primary" size="sm" onClick={generate} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft summaries with Gemini
          </Button>
          {error ? <span className="text-risk">{error}</span> : null}
        </div>
      ) : null}
      <div className="space-y-4">
        {visible.map((i) => (
          <SummaryCard key={i.counterpartyId} item={i} readOnly={readOnly} />
        ))}
        {items.length > 3 ? (
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3 text-[13.5px]">
            <span className="text-muted">
              {showAll ? "Showing all summaries" : `4–${items.length} ${items.slice(3).map((i) => i.name).join(" · ")}`}
            </span>
            <button type="button" className="text-accent underline" onClick={() => setShowAll((s) => !s)}>
              {showAll ? "Show fewer" : `Show ${items.length - 3} more summaries`}
            </button>
          </div>
        ) : null}
      </div>
      {items.some((i) => i.summary) ? (
        <div className="mt-4">
          <AiDraftBadge />
        </div>
      ) : null}
    </Card>
  );
}

function SummaryCard({ item, readOnly }: { item: Q5View; readOnly: boolean }) {
  const router = useRouter();
  const track = useSave();
  const s = item.summary;
  const [text, setText] = React.useState(s ? (s.analystText ?? s.aiText) : "");
  React.useEffect(() => setText(s ? (s.analystText ?? s.aiText) : ""), [s]);
  if (!s) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-3 text-[14px]">
        <span className="font-semibold">
          {item.rank} {item.name}
        </span>
        <span className="ml-2 text-muted">No summary yet</span>
      </div>
    );
  }
  const [fitLabel, fitTone] = FIT[s.kycFit];
  const status = s.reviewStatus;
  const setStatus = async (reviewStatus: "agree" | "edited" | "needs_rfi") => {
    await track(api(`/api/summaries/${s.id}`, { method: "PATCH", body: { reviewStatus } }));
    router.refresh();
  };
  const id = `q5-${s.id}`;
  return (
    <div className={cn("rounded-lg border px-4 py-4", status === "needs_rfi" ? "border-ai/60" : "border-line")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[15px] font-semibold">
          {item.rank} {item.name}
        </label>
        <span className="text-[13.5px]">
          <span className="text-muted">
            {REL[s.relationshipType] ?? s.relationshipType}
            {s.relationshipSubtype ? ` · ${s.relationshipSubtype}` : ""}
          </span>{" "}
          <span className={fitTone}>{fitLabel}</span>
        </span>
      </div>
      <Textarea
        id={id}
        className="mt-2 min-h-20 text-[13.5px]"
        value={text}
        readOnly={readOnly}
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          if (text === (s.analystText ?? s.aiText)) return;
          await track(api(`/api/summaries/${s.id}`, { method: "PATCH", body: { analystText: text } }));
          router.refresh();
        }}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {s.sources.map((src) => (
            <SourceChip key={src} source={src} />
          ))}
        </div>
        <div role="radiogroup" aria-label={`Review status for ${item.name}`} className="inline-flex overflow-hidden rounded-md border border-line text-[12.5px]">
          {(
            [
              ["agree", "Agree", "bg-accent text-white"],
              ["edited", "Edited", "bg-accent text-white"],
              ["needs_rfi", "Needs RFI", "bg-ai text-white"],
            ] as const
          ).map(([v, label, on]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={status === v}
              disabled={readOnly}
              onClick={() => setStatus(v)}
              className={cn("border-l border-line px-2.5 py-1 first:border-l-0", status === v ? on : "bg-surface hover:bg-page")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
