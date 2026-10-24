"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { api } from "@/lib/client/api";
import { formatAmount, formatDate } from "@/lib/format";
import type { TxnRow } from "@/lib/cases/transactions";
import { SourceChip } from "./document-preview";

type Filter = { inPeriod?: boolean; ids?: number[] };

/** Paged, filterable transaction table in a drawer ("View", "View all 7", …). */
export function TransactionsDialog({
  caseId,
  title,
  filter,
  trigger,
}: {
  caseId: number;
  title: string;
  filter: Filter;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [q, setQ] = React.useState("");
  const [data, setData] = React.useState<{ rows: TxnRow[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const ids = filter.ids?.join(",");

  React.useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (filter.inPeriod !== undefined) params.set("inPeriod", String(filter.inPeriod));
    if (ids) params.set("ids", ids);
    if (q.trim()) params.set("q", q.trim());
    const t = setTimeout(() => {
      api<{ rows: TxnRow[]; total: number; pageSize: number }>(`/api/cases/${caseId}/transactions?${params}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError((e as Error).message));
    }, 200);
    return () => clearTimeout(t);
  }, [open, page, q, caseId, filter.inPeriod, ids]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent side="right" className="max-w-[920px]" title={title} description={data ? `${data.total} transactions` : undefined}>
        <Input
          placeholder="Search counterparty, transaction ID or reference"
          aria-label="Search transactions"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {error ? <p className="mt-3 text-[13px] text-risk">{error}</p> : null}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="text-[12px] text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Txn ID</th>
                <th className="py-2 pr-3 font-medium">Dir.</th>
                <th className="py-2 pr-3 font-medium">Counterparty</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 text-right font-medium">Amount</th>
                <th className="py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {data?.rows.map((t) => (
                <tr key={t.id} className="border-t border-line align-top">
                  <td className="py-2 pr-3 font-mono">{formatDate(t.date)}</td>
                  <td className="py-2 pr-3 font-mono">
                    {t.transactionId}
                    {t.idGenerated ? <span className="ml-1 text-[11px] text-ai">(generated)</span> : null}
                  </td>
                  <td className="py-2 pr-3">{t.direction === "incoming" ? "In" : "Out"}</td>
                  <td className="py-2 pr-3">
                    {t.counterpartyName ?? "—"}
                    {t.counterpartyAccount ? <span className="ml-1 font-mono text-[11.5px] text-muted">{t.counterpartyAccount}</span> : null}
                    {t.referenceText ? <div className="text-[12px] text-muted">{t.referenceText}</div> : null}
                  </td>
                  <td className="py-2 pr-3">{t.type ?? "—"}</td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {formatAmount(t.amount, 2)} {t.currency}
                  </td>
                  <td className="py-2">
                    <SourceChip source={t.source} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-[13px]">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="text-muted">
              Page {page} of {pages}
            </span>
            <Button size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
