"use client";

import * as React from "react";
import { FileSearch } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import { parseSourceRef, type SourceRef } from "@/lib/source-ref";
import { formatAmount, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type PreviewDoc = { id: number; fileName: string; mimeType: string };

type Ctx = { open: (ref: string) => void; canOpen: (ref: string) => boolean };
const PreviewCtx = React.createContext<Ctx | null>(null);

function findDoc(docs: PreviewDoc[], ref: SourceRef | null) {
  if (!ref) return null;
  const f = ref.file.toLowerCase();
  // Exact name first; design-style short names ("alert_report.pdf") match by prefix and extension.
  return (
    docs.find((d) => d.fileName.toLowerCase() === f) ??
    docs.find((d) => {
      const [stem, ext] = [f.replace(/\.[^.]+$/, ""), f.split(".").pop()];
      return d.fileName.toLowerCase().startsWith(stem) && d.fileName.toLowerCase().endsWith("." + ext);
    }) ??
    null
  );
}

export function DocumentPreviewProvider({
  caseId,
  documents,
  children,
}: {
  caseId: number;
  documents: PreviewDoc[];
  children: React.ReactNode;
}) {
  const [target, setTarget] = React.useState<{ doc: PreviewDoc; ref: SourceRef } | null>(null);
  const ctx = React.useMemo<Ctx>(
    () => ({
      canOpen: (r) => !!findDoc(documents, parseSourceRef(r)),
      open: (r) => {
        const ref = parseSourceRef(r);
        const doc = findDoc(documents, ref);
        if (doc && ref) setTarget({ doc, ref });
      },
    }),
    [documents],
  );
  return (
    <PreviewCtx.Provider value={ctx}>
      {children}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        {target ? (
          <DialogContent
            side="right"
            className="max-w-[760px]"
            title={target.doc.fileName}
            description={
              target.ref.page ? `Page ${target.ref.page}` : target.ref.row ? `Row ${target.ref.row}${target.ref.rowEnd ? `–${target.ref.rowEnd}` : ""}` : undefined
            }
          >
            <PreviewBody caseId={caseId} doc={target.doc} sref={target.ref} />
          </DialogContent>
        ) : null}
      </Dialog>
    </PreviewCtx.Provider>
  );
}

type PreviewTxn = { id: number; sourceRow: string; date: string; transactionId: string; direction: string; amount: number; currency: string; counterpartyName: string | null };

function PreviewBody({ caseId, doc, sref }: { caseId: number; doc: PreviewDoc; sref: SourceRef }) {
  const fileUrl = `/api/documents/${doc.id}/file`;
  const isSheet = /sheet|excel|csv/.test(doc.mimeType);
  const [rows, setRows] = React.useState<PreviewTxn[] | null>(null);
  const highlight = React.useRef<HTMLTableRowElement>(null);

  React.useEffect(() => {
    if (!isSheet) return;
    api<{ rows: PreviewTxn[] }>(`/api/cases/${caseId}/transactions?documentId=${doc.id}&pageSize=500`)
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]));
  }, [caseId, doc.id, isSheet]);
  React.useEffect(() => highlight.current?.scrollIntoView({ block: "center" }), [rows]);

  if (doc.mimeType === "application/pdf") {
    return <iframe title={doc.fileName} src={`${fileUrl}#page=${sref.page ?? 1}`} className="h-[75vh] w-full rounded border border-line" />;
  }
  if (doc.mimeType.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fileUrl} alt={doc.fileName} className="w-full rounded border border-line" />;
  }
  if (isSheet) {
    const inRange = (r: PreviewTxn) => {
      const n = Number(r.sourceRow.replace(/\D/g, ""));
      return sref.row != null && n >= sref.row && n <= (sref.rowEnd ?? sref.row);
    };
    return (
      <div>
        <a className="text-[13px] text-accent underline" href={fileUrl}>
          Download original file
        </a>
        {rows === null ? (
          <p className="mt-4 text-[13px] text-muted">Loading rows…</p>
        ) : (
          <table className="mt-4 w-full text-left text-[12.5px]">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Row</th>
                <th className="py-1 pr-2 font-medium">Date</th>
                <th className="py-1 pr-2 font-medium">Txn ID</th>
                <th className="py-1 pr-2 font-medium">Counterparty</th>
                <th className="py-1 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  ref={i === rows.findIndex(inRange) ? highlight : undefined}
                  className={cn("border-t border-line", inRange(r) && "bg-ai-soft")}
                >
                  <td className="py-1 pr-2 font-mono">{r.sourceRow.replace("row ", "")}</td>
                  <td className="py-1 pr-2 font-mono">{formatDate(r.date, false)}</td>
                  <td className="py-1 pr-2 font-mono">{r.transactionId}</td>
                  <td className="py-1 pr-2">{r.counterpartyName ?? "—"}</td>
                  <td className="py-1 text-right font-mono">
                    {r.direction === "outgoing" ? "−" : "+"}
                    {formatAmount(r.amount, 2)} {r.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-3 text-[14px]">
      <p className="text-muted">This file type cannot be previewed in the browser.</p>
      <a className="text-accent underline" href={fileUrl}>
        Download {doc.fileName}
      </a>
    </div>
  );
}

/** Monospace pill "file · p.N" / "file · row N"; opens the preview at that page or row. */
export function SourceChip({ source, className }: { source: string | null | undefined; className?: string }) {
  const ctx = React.useContext(PreviewCtx);
  if (!source) return null;
  const clickable = ctx?.canOpen(source);
  const cls = cn(
    "inline-flex max-w-full items-center gap-1 truncate rounded bg-page px-2 py-0.5 font-mono text-[11.5px] text-muted",
    clickable && "hover:bg-accent-soft hover:text-accent",
    className,
  );
  if (!clickable) return <span className={cls} title={source}>{source}</span>;
  return (
    <button type="button" className={cls} title={`Open ${source}`} onClick={() => ctx!.open(source)}>
      <FileSearch className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{source}</span>
    </button>
  );
}
