import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_ROLES, getCaseForUser, requireRole } from "@/lib/auth/guard";
import { caseAudit } from "@/lib/audit/queries";
import { listVersions, narrativeDiff } from "@/lib/narrative/service";
import { DISPOSITION_LABEL } from "@/lib/export/model";
import type { PMDoc } from "@/lib/narrative/doc";
import { formatDate, formatDuration } from "@/lib/format";
import { DocView } from "@/components/narrative/doc-view";
import { DiffView } from "@/components/narrative/diff-view";
import { AuditTable } from "@/components/review/audit-table";
import { ReviewTabs } from "@/components/review/review-tabs";
import { ExportPanel } from "@/components/narrative/side-panels";

export const metadata = { title: "QA review · TM Summary Drafter" };

/** QA read-only view: final narrative, original AI draft, diff, edit history, audit log. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(Number((await params).id), user).catch(() => notFound());
  const [versions, diff, audit] = await Promise.all([listVersions(c.id), narrativeDiff(c.id), caseAudit(c.id, 2000, { includeAi: true })]);
  const latest = versions[versions.length - 1];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 rounded-xl border border-line bg-surface p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] font-semibold">QA review · read-only</h2>
          {user.role === "analyst" ? (
            <Link href={`/cases/${c.id}/narrative`} className="text-[13px] text-accent underline">
              Open in editor
            </Link>
          ) : null}
        </div>
        {!latest ? (
          <p className="text-[14px] text-muted">No narrative has been generated for this case yet.</p>
        ) : (
          <ReviewTabs
            tabs={[
              { id: "final", label: `Final narrative (v${latest.version})`, content: <DocView doc={latest.contentJson as PMDoc} /> },
              { id: "ai", label: "Original AI draft v1", content: <DocView doc={versions[0].contentJson as PMDoc} /> },
              {
                id: "diff",
                label: `Diff (+${diff?.added ?? 0} / −${diff?.removed ?? 0})`,
                content: (
                  <>
                    <p className="mb-4 text-[12.5px] text-muted">{diff?.pctKept}% of AI text kept</p>
                    {diff ? <DiffView sections={diff.sections} /> : null}
                  </>
                ),
              },
              {
                id: "history",
                label: `Edit history (${versions.length})`,
                content: (
                  <ol className="space-y-2 text-[13.5px]">
                    {versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap gap-3 border-b border-line pb-2">
                        <span className="font-mono">v{v.version}</span>
                        <span>{v.kind === "ai_draft" ? `AI draft (${v.model}, ${v.promptVersion})` : "Analyst version"}</span>
                        <span className="font-mono text-muted">{v.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                      </li>
                    ))}
                  </ol>
                ),
              },
              { id: "audit", label: "Audit log", content: <AuditTable events={audit} /> },
            ]}
          />
        )}
      </section>
      <div className="space-y-6">
        <section className="rounded-xl border border-line bg-surface p-5 text-[14px]">
          <h2 className="text-[18px] font-semibold">Decision</h2>
          <dl className="mt-3 space-y-2">
            <div>
              <dt className="text-[12px] text-muted">Status</dt>
              <dd>{c.status === "approved" ? `Approved ${c.approvedAt ? formatDate(c.approvedAt.toISOString().slice(0, 10)) : ""}` : "Drafting"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Disposition</dt>
              <dd className="font-semibold">{c.disposition ? DISPOSITION_LABEL[c.disposition] : "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Rationale</dt>
              <dd>{c.rationale || "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Time-to-draft (wall-clock · active)</dt>
              <dd className="font-mono">
                {c.timeToDraftSeconds != null ? formatDuration(c.timeToDraftSeconds) : "—"} · {formatDuration(c.activeSeconds)}
              </dd>
            </div>
          </dl>
        </section>
        {latest ? <ExportPanel caseId={c.id} /> : null}
      </div>
    </div>
  );
}
