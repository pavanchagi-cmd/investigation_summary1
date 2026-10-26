"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Stat } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";
import { AiDraftBadge } from "@/components/case/badges";
import { SourceChip } from "@/components/case/document-preview";
import { useSave } from "@/components/case/save-status";
import { TransactionsDialog } from "@/components/case/transactions-dialog";
import { api } from "@/lib/client/api";
import { formatAmount, formatDate } from "@/lib/format";
import type { FieldView } from "@/lib/cases/fields";
import type { DocumentSummary } from "@/lib/documents/service";
import type { IssueRow } from "@/lib/documents/issues";
import { DocumentsPanel } from "./documents-panel";
import { RemoveEmptySubAlertsButton } from "@/components/purpose/generate-button";

export const SCENARIO_LABELS = {
  large_amount: "Large Amount Transaction",
  pattern_of_funds: "Pattern of Funds",
  round_dollar: "Round Dollar Transaction",
  wire_structuring: "Wire Structuring",
} as const;
type ScenarioKey = keyof typeof SCENARIO_LABELS;

type SubAlertView = {
  id: number;
  subAlertNumber: string;
  scenario: ScenarioKey | null;
  ruleId: string | null;
  threshold: string | null;
  triggerDetails: string | null;
  triggeringTxnCount: number | null;
  sourceRef: string | null;
  isAi: boolean;
};

export function IntakeScreen(props: {
  caseId: number;
  alertNumber: string;
  readOnly: boolean;
  subAlerts: SubAlertView[];
  fields: FieldView[];
  reviewStart: string | null;
  reviewEnd: string | null;
  stats: { inPeriod: number; excluded: number; flow: number };
  documents: DocumentSummary[];
  issues: IssueRow[];
  uploadMode: "blob" | "local";
  demoFiles: string[];
}) {
  const router = useRouter();
  const anyPending = props.documents.some((d) => d.parseStatus === "pending");

  // Poll while documents are being parsed in the background.
  React.useEffect(() => {
    if (!anyPending) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [anyPending, router]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-6">
        <Q1Card {...props} />
        <Q2Card {...props} />
      </div>
      <div className="space-y-6">
        <DocumentsPanel
          caseId={props.caseId}
          readOnly={props.readOnly}
          documents={props.documents}
          issues={props.issues}
          uploadMode={props.uploadMode}
          demoFiles={props.demoFiles}
        />
        <Button asChild variant="primary" size="lg" className="w-full">
          <Link href={`/cases/${props.caseId}/client`}>
            Continue to client & counterparties <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Q1Card({ caseId, alertNumber, readOnly, subAlerts, fields }: Parameters<typeof IntakeScreen>[0]) {
  const router = useRouter();
  const track = useSave();
  const reportNumber = fields.find((f) => f.fieldKey === "report_alert_number");
  const alertDate = fields.find((f) => f.fieldKey === "alert_date");
  const reportValue = typeof reportNumber?.value === "string" ? reportNumber.value.trim().toUpperCase() : null;
  const mismatch = !!reportValue && reportValue !== alertNumber;
  const anyAi = subAlerts.some((s) => s.isAi);
  const emptyCount = subAlerts.filter(
    (s) => !s.isAi && !s.scenario && !s.ruleId && !s.threshold && !s.triggerDetails && s.triggeringTxnCount == null,
  ).length;
  const [draft, setDraft] = React.useState(alertNumber);
  const [numberError, setNumberError] = React.useState<string | null>(null);
  React.useEffect(() => setDraft(alertNumber), [alertNumber]);
  const dirty = draft.trim().toUpperCase() !== alertNumber;

  async function patch(body: object) {
    await track(api(`/api/cases/${caseId}`, { method: "PATCH", body }));
    router.refresh();
  }

  async function saveNumber(value: string) {
    setNumberError(null);
    try {
      await patch({ action: "set_alert_number", alertNumber: value });
    } catch (err) {
      setNumberError((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader title="Q1 · Alert number" aside={anyAi ? <AiDraftBadge /> : null} />
      <Label htmlFor="q1-alert">Alert number (required)</Label>
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && draft.trim()) saveNumber(draft);
        }}
      >
        <Input
          id="q1-alert"
          className="max-w-[420px] font-mono"
          value={draft}
          readOnly={readOnly}
          aria-describedby={numberError ? "q1-alert-error" : undefined}
          onChange={(e) => setDraft(e.target.value)}
        />
        {!readOnly && dirty ? (
          <>
            <Button type="submit" variant="primary" disabled={!draft.trim()}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => (setDraft(alertNumber), setNumberError(null))}>
              Cancel
            </Button>
          </>
        ) : mismatch ? null : (
          <span className="rounded-md bg-ok-soft px-3 py-2 text-[13px] font-medium text-ok">Alert loaded</span>
        )}
        <SourceChip source={reportNumber?.sourceRef} />
      </form>
      {numberError ? (
        <p id="q1-alert-error" role="alert" className="mt-2 text-[13px] text-risk">
          {numberError}
        </p>
      ) : null}
      {mismatch ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 rounded-md bg-risk-soft px-3 py-2 text-[13px] text-risk">
          <span className="min-w-0 flex-1">
            The alert report states alert number <span className="font-mono">{reportValue}</span>, not{" "}
            <span className="font-mono">{alertNumber}</span>. Check the uploaded report, or correct the alert number.
          </span>
          {!readOnly ? (
            <Button size="sm" onClick={() => saveNumber(reportValue!)}>
              Use {reportValue}
            </Button>
          ) : null}
        </div>
      ) : null}
      {alertDate?.value ? (
        <p className="mt-2 text-[13px] text-muted">
          Alert generated <span className="font-mono">{formatDate(String(alertDate.value))}</span> <SourceChip source={alertDate.sourceRef} />
        </p>
      ) : null}

      <div className="mt-6 mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Sub-alerts ({subAlerts.length})</h3>
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            {emptyCount > 0 ? <RemoveEmptySubAlertsButton caseId={caseId} count={emptyCount} /> : null}
            <Button onClick={() => patch({ action: "add_sub_alert" })}>
              <Plus /> Add sub-alert
            </Button>
          </div>
        ) : null}
      </div>
      {subAlerts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
          No sub-alerts yet. They are read from the alert report once it is uploaded, or add them here.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[760px] text-left text-[13.5px]">
            <thead className="bg-page text-[12.5px] text-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Sub-alert</th>
                <th className="px-3 py-2.5 font-medium">Scenario</th>
                <th className="px-3 py-2.5 font-medium">Trigger details</th>
                <th className="px-3 py-2.5 font-medium">Triggering txns</th>
                <th className="px-3 py-2.5 font-medium">Source</th>
                <th className="px-3 py-2.5">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {subAlerts.map((s) => (
                <SubAlertRow key={s.id} s={s} readOnly={readOnly} onPatch={patch} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SubAlertRow({ s, readOnly, onPatch }: { s: SubAlertView; readOnly: boolean; onPatch: (b: object) => Promise<void> }) {
  const [details, setDetails] = React.useState(
    [s.ruleId ? `Rule ${s.ruleId}` : null, s.triggerDetails].filter(Boolean).join(" · "),
  );
  const [count, setCount] = React.useState(s.triggeringTxnCount?.toString() ?? "");
  const [number, setNumber] = React.useState(s.subAlertNumber);
  React.useEffect(() => setNumber(s.subAlertNumber), [s.subAlertNumber]);
  const update = (patch: object) => onPatch({ action: "update_sub_alert", id: s.id, patch });
  const id = `sub-${s.id}`;

  return (
    <tr className="border-t border-line align-top">
      <td className="px-3 py-2.5">
        <Input
          aria-label="Sub-alert number"
          className="h-9 w-[180px] font-mono text-[13px]"
          value={number}
          readOnly={readOnly}
          onChange={(e) => setNumber(e.target.value)}
          onBlur={() => number !== s.subAlertNumber && number.trim() && update({ subAlertNumber: number.trim() })}
        />
      </td>
      <td className="px-3 py-2.5">
        <Select
          id={`${id}-scenario`}
          aria-label={`Scenario for sub-alert ${s.subAlertNumber}`}
          className="h-9 w-[220px]"
          value={s.scenario ?? ""}
          disabled={readOnly}
          onChange={(e) => update({ scenario: e.target.value || null })}
        >
          <option value="">Select scenario…</option>
          {Object.entries(SCENARIO_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-3 py-2.5">
        <Input
          aria-label="Trigger details"
          className="h-9 min-w-[240px]"
          value={details}
          readOnly={readOnly}
          placeholder="Rule ID · threshold · details"
          onChange={(e) => setDetails(e.target.value)}
          onBlur={() => {
            const m = details.match(/^Rule\s+([A-Z0-9-]+)\s*·?\s*(.*)$/i);
            const patch = m ? { ruleId: m[1], triggerDetails: m[2] || null } : { triggerDetails: details || null };
            if (patch.triggerDetails !== s.triggerDetails || ("ruleId" in patch && patch.ruleId !== s.ruleId)) update(patch);
          }}
        />
      </td>
      <td className="px-3 py-2.5">
        <Input
          aria-label="Triggering transaction count"
          inputMode="numeric"
          className="h-9 w-20 font-mono"
          value={count}
          readOnly={readOnly}
          onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
          onBlur={() => {
            const n = count === "" ? null : Number(count);
            if (n !== s.triggeringTxnCount) update({ triggeringTxnCount: n });
          }}
        />
      </td>
      <td className="px-3 py-2.5">
        <SourceChip source={s.sourceRef} />
      </td>
      <td className="px-3 py-2.5 text-right">
        {!readOnly ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove sub-alert ${s.subAlertNumber}`}
            onClick={() => onPatch({ action: "remove_sub_alert", id: s.id })}
          >
            <Trash2 />
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

function Q2Card({ caseId, readOnly, fields, reviewStart, reviewEnd, stats }: Parameters<typeof IntakeScreen>[0]) {
  const router = useRouter();
  const track = useSave();
  const [start, setStart] = React.useState(reviewStart ?? "");
  const [end, setEnd] = React.useState(reviewEnd ?? "");
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setStart(reviewStart ?? "");
    setEnd(reviewEnd ?? "");
  }, [reviewStart, reviewEnd]);
  const startField = fields.find((f) => f.fieldKey === "review_start");
  const state = startField?.status ?? "ai";
  const valid = !!start && !!end && start <= end;

  async function save(s: string, e: string) {
    if (!s || !e) return;
    if (s > e) {
      setError("Start date must be on or before the end date");
      return;
    }
    setError(null);
    if (s === reviewStart && e === reviewEnd) return;
    await track(api(`/api/cases/${caseId}`, { method: "PATCH", body: { action: "set_review_period", start: s, end: e } }));
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Q2 · Review period" aside={startField ? <AiDraftBadge state={state} /> : null} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="q2-start">Start date</Label>
          <Input
            id="q2-start"
            type="date"
            className="font-mono"
            value={start}
            readOnly={readOnly}
            onChange={(e) => setStart(e.target.value)}
            onBlur={() => save(start, end)}
          />
        </div>
        <div>
          <Label htmlFor="q2-end">End date</Label>
          <Input
            id="q2-end"
            type="date"
            className="font-mono"
            value={end}
            readOnly={readOnly}
            onChange={(e) => setEnd(e.target.value)}
            onBlur={() => save(start, end)}
          />
        </div>
        <div className="min-w-0 pb-1">
          <SourceChip source={startField?.sourceRef} />
          <div className={`mt-1 text-[12.5px] ${valid ? "text-ok" : "text-muted"}`}>
            {valid ? "Start ≤ end ✓" : start || end ? "Set both dates" : "Not provided in documents"}
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-risk">
          {error}
        </p>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="In period · used in analysis" value={`${stats.inPeriod} txns`} />
        <Stat
          label="Excluded · outside period"
          value={`${stats.excluded} txns`}
          extra={
            stats.excluded > 0 ? (
              <TransactionsDialog
                caseId={caseId}
                title="Transactions outside the review period"
                filter={{ inPeriod: false }}
                trigger={
                  <button type="button" className="font-sans text-[13px] text-accent underline">
                    View
                  </button>
                }
              />
            ) : null
          }
        />
        <Stat label="Total in-period flow (USD)" value={formatAmount(stats.flow)} />
      </div>
    </Card>
  );
}
