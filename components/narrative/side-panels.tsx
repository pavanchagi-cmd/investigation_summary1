"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/form";
import { useSave } from "@/components/case/save-status";
import { api } from "@/lib/client/api";
import { narrativeFlush } from "@/lib/client/flush";
import { cn } from "@/lib/utils";

export const DISPOSITIONS = [
  { value: "escalate_sar", label: "Escalate to SAR/STR review" },
  { value: "close_nfa", label: "Close – no further action" },
  { value: "request_info", label: "Request more information" },
] as const;

/** The analyst decides: disposition + rationale, then Approve (explicit action, never automatic). */
export function DispositionPanel({
  caseId,
  disposition,
  rationale,
  locked,
  blockers,
  canUnlock,
  approvedLabel,
}: {
  caseId: number;
  disposition: string | null;
  rationale: string | null;
  locked: boolean;
  blockers: string[];
  canUnlock: boolean;
  approvedLabel: string | null;
}) {
  const router = useRouter();
  const track = useSave();
  const [d, setD] = React.useState(disposition ?? "");
  const [r, setR] = React.useState(rationale ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const saved = React.useRef({ d: disposition ?? "", r: rationale ?? "" });

  async function saveDisposition(nextD: string, nextR: string) {
    if (saved.current.d === nextD && saved.current.r === nextR) return;
    saved.current = { d: nextD, r: nextR };
    await track(api(`/api/cases/${caseId}`, { method: "PATCH", body: { action: "set_disposition", disposition: nextD || null, rationale: nextR } }));
    router.refresh();
  }

  const localBlockers = [...blockers.filter((b) => !/disposition|rationale/i.test(b))];
  if (!d) localBlockers.push("Choose a disposition");
  if (r.trim().length < 20) localBlockers.push("Write a rationale of at least 20 characters");

  return (
    <section aria-labelledby="disposition-title" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="disposition-title" className="text-[18px] font-semibold">
        Disposition
      </h2>
      <p className="mt-1 text-[13px] text-muted">Analyst decision. The AI does not close or escalate cases.</p>
      <fieldset className="mt-4 space-y-2" disabled={locked}>
        <legend className="sr-only">Disposition</legend>
        {DISPOSITIONS.map((o) => (
          <label
            key={o.value}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-[14px] font-medium",
              d === o.value ? "border-accent bg-accent-soft" : "border-line hover:bg-page",
            )}
          >
            <input
              type="radio"
              name="disposition"
              value={o.value}
              checked={d === o.value}
              onChange={() => {
                setD(o.value);
                void saveDisposition(o.value, r);
              }}
              className="size-4 accent-[#1F4FD1]"
            />
            {o.label}
          </label>
        ))}
      </fieldset>
      <Label htmlFor="rationale" className="mt-4">
        Rationale (required)
      </Label>
      <Textarea
        id="rationale"
        value={r}
        readOnly={locked}
        onChange={(e) => setR(e.target.value)}
        onBlur={() => saveDisposition(d, r)}
        aria-describedby="rationale-hint"
      />
      <p id="rationale-hint" className="mt-1 text-[12px] text-muted">
        At least 20 characters. Included in exports.
      </p>
      {locked ? (
        <div className="mt-4 rounded-lg bg-ok-soft px-4 py-3 text-[13.5px] text-ok">
          <div className="flex items-center gap-2 font-semibold">
            <Lock className="size-4" /> Approved and locked
          </div>
          {approvedLabel ? <div className="mt-1">{approvedLabel}</div> : null}
          {canUnlock ? <UnlockDialog caseId={caseId} /> : null}
        </div>
      ) : (
        <>
          <Button
            variant="primary"
            size="lg"
            className="mt-4 w-full"
            disabled={busy || localBlockers.length > 0}
            aria-describedby={localBlockers.length ? "approve-blockers" : undefined}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await narrativeFlush.current();
                await saveDisposition(d, r);
                await track(api(`/api/cases/${caseId}/approve`, { body: {} }));
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Approve narrative
          </Button>
          {localBlockers.length ? (
            <ul id="approve-blockers" className="mt-3 list-disc space-y-1 pl-5 text-[12.5px] text-muted">
              {localBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-risk">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function UnlockDialog({ caseId }: { caseId: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="mt-3">
          Unlock to edit
        </Button>
      </DialogTrigger>
      <DialogContent title="Unlock the narrative" description="This clears the approval, creates a new version and is recorded in the audit log.">
        <Label htmlFor="unlock-reason">Reason (required)</Label>
        <Textarea id="unlock-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error ? <p className="mt-2 text-[13px] text-risk">{error}</p> : null}
        <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            disabled={reason.trim().length < 3}
            onClick={async () => {
              try {
                await api(`/api/cases/${caseId}/unlock`, { body: { reason } });
                setOpen(false);
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Unlock
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ExportPanel({ caseId }: { caseId: number }) {
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const go = async (format: "docx" | "pdf") => {
    await narrativeFlush.current();
    window.location.href = `/api/cases/${caseId}/export?format=${format}`;
  };
  return (
    <section aria-labelledby="export-title" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="export-title" className="text-[18px] font-semibold">
        Export
      </h2>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button onClick={() => go("docx")}>Word</Button>
        <Button onClick={() => go("pdf")}>PDF</Button>
        <Button
          onClick={async () => {
            setError(null);
            try {
              await narrativeFlush.current();
              const res = await fetch(`/api/cases/${caseId}/export?format=txt`);
              if (!res.ok) throw new Error("Export failed");
              await navigator.clipboard.writeText(await res.text());
              setCopied(true);
              setTimeout(() => setCopied(false), 2500);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy text"}
        </Button>
      </div>
      {error ? <p className="mt-2 text-[13px] text-risk">{error}</p> : null}
    </section>
  );
}

export type AuditItem = { id: number; at: string; text: string };

export function AuditPanel({ caseId, items }: { caseId: number; items: AuditItem[] }) {
  return (
    <section aria-labelledby="audit-title" className="rounded-xl border border-line bg-surface p-5">
      <h2 id="audit-title" className="text-[18px] font-semibold">
        Audit trail
      </h2>
      <ol className="mt-3 space-y-2 text-[13.5px]">
        {items.map((i) => (
          <li key={i.id} className="flex gap-3">
            <span className="shrink-0 font-mono text-muted">{i.at}</span>
            <span>{i.text}</span>
          </li>
        ))}
        {items.length === 0 ? <li className="text-muted">No events yet.</li> : null}
      </ol>
      <Link href={`/cases/${caseId}/audit`} className="mt-3 inline-block text-[13px] text-accent underline">
        Full log
      </Link>
    </section>
  );
}
