"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

/** Disabled until Q1–Q4 are complete and parse issues are resolved; shows what is missing as text. */
export function GenerateNarrativeButton({
  caseId,
  blockers,
  hasNarrative,
  readOnly,
}: {
  caseId: number;
  blockers: string[];
  hasNarrative: boolean;
  readOnly: boolean;
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
      {blockers.length ? <BlockerList id="narrative-blockers" caseId={caseId} blockers={blockers} /> : null}
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
  if (/^Q[34]:/.test(b)) return { path: "client", label: "Client & counterparties" };
  return { path: "intake", label: "Alert & documents" };
}

/** What still stops the narrative, each with a link to the screen that fixes it. */
export function BlockerList({ id, caseId, blockers }: { id?: string; caseId: number; blockers: string[] }) {
  return (
    <ul id={id} className="mt-3 list-disc space-y-1 pl-5 text-left text-[12.5px] text-muted">
      {blockers.map((b) => {
        const step = blockerStep(b);
        return (
          <li key={b}>
            {b} ·{" "}
            <Link href={`/cases/${caseId}/${step.path}`} className="text-accent underline">
              {step.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
