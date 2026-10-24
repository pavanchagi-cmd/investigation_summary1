"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/form";
import { useSave } from "@/components/case/save-status";
import { TransactionsDialog } from "@/components/case/transactions-dialog";
import { api } from "@/lib/client/api";
import { formatAmount, formatDate } from "@/lib/format";
import type { FindingView } from "@/lib/analysis/queries";
import { cn } from "@/lib/utils";

export const SCENARIOS = [
  { key: "wire_structuring", label: "Wire Structuring" },
  { key: "pattern_of_funds", label: "Pattern of Funds" },
  { key: "round_dollar", label: "Round Dollar Transaction" },
  { key: "large_amount", label: "Large Amount Transaction" },
] as const;

/** One card per scenario. Dismissed cards stay visible, greyed, with the reason and who dismissed. */
export function RedFlagsPanel({
  caseId,
  findings,
  checkedCount,
  readOnly,
  baseCcy,
  footer,
}: {
  caseId: number;
  findings: FindingView[];
  checkedCount: number;
  readOnly: boolean;
  baseCcy: string;
  footer?: React.ReactNode;
}) {
  const ordered = [...SCENARIOS].sort((a, b) => {
    const fa = findings.find((f) => f.scenario === a.key);
    const fb = findings.find((f) => f.scenario === b.key);
    const rank = (f?: FindingView) => (!f ? 2 : f.dismissed ? 1 : 0);
    return rank(fa) - rank(fb);
  });
  return (
    <section aria-labelledby="red-flags-title" className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="red-flags-title" className="text-[18px] font-semibold">
          Red flags
        </h2>
        <span className="text-[12.5px] text-muted">
          4 scenarios · {checkedCount} txns checked
        </span>
      </div>
      <div className="space-y-4">
        {ordered.map((s) => {
          const f = findings.find((x) => x.scenario === s.key);
          return <FlagCard key={s.key} caseId={caseId} label={s.label} finding={f} readOnly={readOnly} baseCcy={baseCcy} />;
        })}
      </div>
      {footer ? <div className="mt-5">{footer}</div> : null}
    </section>
  );
}

function FlagCard({ caseId, label, finding, readOnly, baseCcy }: { caseId: number; label: string; finding?: FindingView; readOnly: boolean; baseCcy: string }) {
  const router = useRouter();
  const track = useSave();
  if (!finding) {
    return (
      <div className="rounded-lg border border-line px-4 py-3">
        <div className="flex items-center justify-between text-[14px]">
          <span className="font-semibold">{label}</span>
          <span className="text-ok">No match</span>
        </div>
      </div>
    );
  }
  const n = finding.matchedTxnIds.length;
  if (finding.dismissed) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-page/60 px-4 py-3 text-muted">
        <div className="flex items-center justify-between text-[14px]">
          <span className="font-semibold">{label}</span>
          <span>Dismissed</span>
        </div>
        <p className="mt-1 text-[13px]">
          {finding.summary} Dismissed by {finding.dismissedByName ?? "analyst"}: “{finding.dismissReason}”
        </p>
        {!readOnly ? (
          <Button
            size="sm"
            variant="link"
            className="mt-1"
            onClick={async () => {
              await track(api(`/api/findings/${finding.id}`, { method: "PATCH", body: { dismissed: false } }));
              router.refresh();
            }}
          >
            Restore
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className="flex items-center justify-between text-[14px]">
        <span className="font-semibold">{label}</span>
        <span className={cn("font-medium", finding.scenario === "round_dollar" ? "text-ai" : "text-risk")}>
          {n} match{n === 1 ? "" : "es"}
        </span>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{finding.summary}</p>
      {finding.scenario === "wire_structuring" && finding.preview.length ? (
        <table className="mt-2 w-full text-[12.5px]">
          <thead className="text-muted">
            <tr>
              <th className="py-1 text-left font-medium">Date</th>
              <th className="py-1 text-left font-medium">Txn ID</th>
              <th className="py-1 text-right font-medium">{baseCcy}</th>
            </tr>
          </thead>
          <tbody>
            {finding.preview.map((t) => (
              <tr key={t.id} className="border-t border-line font-mono">
                <td className="py-1.5">{formatDate(t.date, false)}</td>
                <td className="py-1.5">{t.transactionId}</td>
                <td className="py-1.5 text-right">{formatAmount(t.amount, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : finding.preview.length ? (
        <ul className="mt-2 space-y-0.5 font-mono text-[12px] text-muted">
          {finding.preview.map((t) => (
            <li key={t.id}>
              {formatDate(t.date, false)} · {t.transactionId} · {formatAmount(t.amount, 2)}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <TransactionsDialog
          caseId={caseId}
          title={`${label} · matched transactions`}
          filter={{ ids: finding.matchedTxnIds }}
          trigger={
            <button type="button" className="text-[13px] text-accent underline">
              {finding.scenario === "wire_structuring" ? `View all ${n}` : `View ${n} txns`}
            </button>
          }
        />
        {!readOnly ? <DismissDialog findingId={finding.id} label={label} /> : null}
      </div>
    </div>
  );
}

function DismissDialog({ findingId, label }: { findingId: number; label: string }) {
  const router = useRouter();
  const track = useSave();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Dismiss…</Button>
      </DialogTrigger>
      <DialogContent title={`Dismiss ${label}`} description="The finding stays visible, greyed, with your reason. The narrative will treat it as dismissed.">
        <Label htmlFor={`dismiss-${findingId}`}>Reason (required)</Label>
        <Textarea id={`dismiss-${findingId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        {error ? <p className="mt-2 text-[13px] text-risk">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            disabled={reason.trim().length < 3}
            onClick={async () => {
              try {
                await track(api(`/api/findings/${findingId}`, { method: "PATCH", body: { dismissed: true, reason } }));
                setOpen(false);
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Dismiss finding
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
