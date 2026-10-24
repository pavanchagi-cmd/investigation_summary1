"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { useSave } from "@/components/case/save-status";
import { api } from "@/lib/client/api";
import { TXN_FIELD_LABELS, type TxnField } from "@/lib/parsing/headers";
import type { DocumentSummary } from "@/lib/documents/service";
import type { IssueRow } from "@/lib/documents/issues";

function useAction() {
  const router = useRouter();
  const track = useSave();
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await track(fn());
      router.refresh();
      return r;
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy };
}

/** Fix: edit the failing values of each row; the row is re-validated on save. */
export function FixRowsDialog({ caseId, doc, issues }: { caseId: number; doc: DocumentSummary; issues: IssueRow[] }) {
  const rows = React.useMemo(() => {
    const m = new Map<string, IssueRow[]>();
    for (const i of issues) m.set(i.sourceRowOrPage, [...(m.get(i.sourceRowOrPage) ?? []), i]);
    return [...m.entries()];
  }, [issues]);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">Fix rows</Button>
      </DialogTrigger>
      <DialogContent title={`Fix rows · ${doc.fileName}`} description="Correct the values; each row is validated again when you save it.">
        <div className="space-y-5">
          {rows.map(([row, list]) => (
            <FixRow key={row} caseId={caseId} row={row} issues={list} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function fieldsFor(issue: IssueRow): TxnField[] {
  if (issue.field && issue.field in TXN_FIELD_LABELS) return [issue.field as TxnField];
  return ["debit", "credit"];
}

function FixRow({ caseId, row, issues }: { caseId: number; row: string; issues: IssueRow[] }) {
  const fields = [...new Set(issues.flatMap(fieldsFor))];
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f, issues.find((i) => i.field === f)?.rawValue ?? ""])),
  );
  const [reason, setReason] = React.useState("");
  const [result, setResult] = React.useState<string[] | null>(null);
  const { run, error, busy } = useAction();

  return (
    <fieldset className="rounded-lg border border-line p-4">
      <legend className="px-1 font-mono text-[13px]">{row.replace(/^row/, "Row")}</legend>
      <ul className="mb-3 list-disc pl-5 text-[13px] text-ai">
        {issues.map((i) => (
          <li key={i.id}>{i.problem}</li>
        ))}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f}>
            <Label htmlFor={`fix-${issues[0].id}-${f}`}>{TXN_FIELD_LABELS[f]}</Label>
            <Input
              id={`fix-${issues[0].id}-${f}`}
              className="font-mono"
              value={values[f] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={async () => {
            const r = await run(() =>
              api<{ remaining: string[] }>(`/api/cases/${caseId}/parse-issues`, {
                method: "PATCH",
                body: { action: "fix", issueId: issues[0].id, values },
              }),
            );
            if (r) setResult(r.remaining);
          }}
        >
          Save fix
        </Button>
        <div className="flex min-w-[240px] flex-1 items-end gap-2">
          <Input aria-label={`Reason to exclude ${row}`} placeholder="…or exclude with reason" value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 text-[13px]" />
          <Button
            size="sm"
            variant="danger"
            disabled={busy || reason.trim().length < 3}
            onClick={() =>
              run(() =>
                api(`/api/cases/${caseId}/parse-issues`, { method: "PATCH", body: { action: "exclude", issueId: issues[0].id, reason } }),
              )
            }
          >
            Exclude row
          </Button>
        </div>
      </div>
      {result ? (
        <p role="status" className={`mt-2 text-[13px] ${result.length ? "text-risk" : "text-ok"}`}>
          {result.length ? `Still failing: ${result.join("; ")}` : "Fixed – the row is now included."}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-risk">{error}</p> : null}
    </fieldset>
  );
}

/** Exclude every open issue in a file with one reason (explicit acceptance, logged). */
export function ExcludeDialog({ caseId, doc, count }: { caseId: number; doc: DocumentSummary; count: number }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { run, error, busy } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Exclude with reason</Button>
      </DialogTrigger>
      <DialogContent title="Exclude rows with a reason" description={`${count} open issue${count === 1 ? "" : "s"} in ${doc.fileName}. Excluded rows are counted and listed, never silently dropped.`}>
        <Label htmlFor="exclude-reason">Reason (required)</Label>
        <Textarea id="exclude-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate of row 117; confirmed with operations" />
        {error ? <p className="mt-2 text-[13px] text-risk">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              await run(() =>
                api(`/api/cases/${caseId}/parse-issues`, { method: "PATCH", body: { action: "exclude_all", documentId: doc.id, reason } }),
              );
              setOpen(false);
            }}
          >
            Exclude {count} issue{count === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const MAP_FIELDS: TxnField[] = ["date", "amount", "direction", "debit", "credit", "currency", "counterparty_name", "transaction_id"];

/** Shown instead of failing when required columns (date, amount, direction or debit/credit) cannot be matched. */
export function MappingDialog({ doc }: { doc: DocumentSummary }) {
  const [open, setOpen] = React.useState(false);
  const [mapping, setMapping] = React.useState<Record<string, string>>(doc.columnMapping ?? {});
  const { run, error, busy } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="primary">
          Map columns
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Map columns · ${doc.fileName}`}
        description={`Could not match: ${doc.missingColumns.join(", ")}. Choose which column holds each value. Use either an amount + direction, or separate debit and credit columns.`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {MAP_FIELDS.map((f) => (
            <div key={f}>
              <Label htmlFor={`map-${f}`}>{TXN_FIELD_LABELS[f]}</Label>
              <Select id={`map-${f}`} value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value }))}>
                <option value="">—</option>
                {f === "direction" ? <option value="__sign__">Derive from the sign of the amount</option> : null}
                {doc.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        {error ? <p className="mt-3 text-[13px] text-risk">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
              await run(() => api(`/api/documents/${doc.id}`, { method: "PATCH", body: { columnMapping: clean } }));
              setOpen(false);
            }}
          >
            Apply mapping and re-parse
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** When neither the rows nor the file state a currency, the analyst confirms the account currency. */
export function CurrencyDialog({ doc }: { doc: DocumentSummary }) {
  const [open, setOpen] = React.useState(false);
  const [ccy, setCcy] = React.useState("");
  const { run, error, busy } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Set account currency</Button>
      </DialogTrigger>
      <DialogContent title="Account currency" description="The file does not state a currency. Enter it only if another document confirms it.">
        <Label htmlFor="doc-ccy">ISO 4217 code</Label>
        <Input id="doc-ccy" className="max-w-[160px] font-mono" maxLength={3} value={ccy} onChange={(e) => setCcy(e.target.value.toUpperCase())} />
        {error ? <p className="mt-2 text-[13px] text-risk">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            disabled={busy || ccy.length !== 3}
            onClick={async () => {
              await run(() => api(`/api/documents/${doc.id}`, { method: "PATCH", body: { currency: ccy } }));
              setOpen(false);
            }}
          >
            Apply and re-parse
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
