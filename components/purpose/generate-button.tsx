"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

/** Disabled until Q1–Q4 are complete and parse issues are resolved; shows what is missing as text. */
export function GenerateNarrativeButton({
  caseId,
  blockers,
  hasNarrative,
  readOnly,
  emptySubAlerts = 0,
}: {
  caseId: number;
  blockers: string[];
  hasNarrative: boolean;
  readOnly: boolean;
  emptySubAlerts?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (hasNarrative || readOnly) {
    return (
      <Button asChild variant="primary" size="lg" className="w-full">
        <Link href={`/cases/${caseId}/narrative`}>Open narrative</Link>
      </Button>
    );
  }
  const disabled = blockers.length > 0 || busy;
  return (
    <div>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        disabled={disabled}
        aria-describedby={blockers.length ? "narrative-blockers" : undefined}
        title={blockers.length ? blockers.join("\n") : undefined}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/api/cases/${caseId}/narrative`, { body: {} });
            router.push(`/cases/${caseId}/narrative`);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {busy ? "Drafting narrative…" : "Generate narrative"}
      </Button>
      {blockers.length ? (
        <BlockerList
          id="narrative-blockers"
          caseId={caseId}
          blockers={blockers}
          emptySubAlerts={emptySubAlerts}
        />
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-risk">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Screen where each blocker can be fixed. */
function blockerStep(b: string) {
  if (/^Q[34]:/.test(b))
    return { path: "client", label: "Client & counterparties" };
  return { path: "intake", label: "Alert & documents" };
}

/** What still stops the narrative, each with a link to the screen that fixes it. */
export function BlockerList({
  id,
  caseId,
  blockers,
  emptySubAlerts = 0,
}: {
  id?: string;
  caseId: number;
  blockers: string[];
  emptySubAlerts?: number;
}) {
  return (
    <>
      <ul
        id={id}
        className="mt-3 list-disc space-y-1 pl-5 text-left text-[12.5px] text-muted"
      >
        {blockers.map((b) => {
          const step = blockerStep(b);
          return (
            <li key={b}>
              {b} ·{" "}
              <Link
                href={`/cases/${caseId}/${step.path}`}
                className="text-accent underline"
              >
                {step.label}
              </Link>
            </li>
          );
        })}
      </ul>
      {emptySubAlerts > 0 ? (
        <RemoveEmptySubAlertsButton
          caseId={caseId}
          count={emptySubAlerts}
          className="mt-3"
        />
      ) : null}
    </>
  );
}

/** One click to delete sub-alerts that were added by hand and never filled in. */
export function RemoveEmptySubAlertsButton({
  caseId,
  count,
  className,
}: {
  caseId: number;
  count: number;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className={className}>
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/api/cases/${caseId}`, {
              method: "PATCH",
              body: { action: "remove_empty_sub_alerts" },
            });
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove{" "}
        {count} empty sub-alert{count === 1 ? "" : "s"}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-risk">
          {error}
        </p>
      ) : null}
    </div>
  );
}
