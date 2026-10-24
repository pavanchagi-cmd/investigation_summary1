import Link from "next/link";
import { loadAnalystCase } from "@/lib/cases/page";
import { listVersions, narrativeDiff, approveBlockers } from "@/lib/narrative/service";
import { caseAudit } from "@/lib/audit/queries";
import type { PMDoc } from "@/lib/narrative/doc";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { NarrativeWorkspace } from "@/components/narrative/narrative-workspace";
import { AuditPanel, DispositionPanel, ExportPanel } from "@/components/narrative/side-panels";

export const metadata = { title: "Narrative & decision · TM Summary Drafter" };

const hhmm = (iso: string) => iso.slice(11, 16);

export default async function NarrativePage({ params }: { params: Promise<{ id: string }> }) {
  const { c, readOnly } = await loadAnalystCase((await params).id);
  const versions = await listVersions(c.id);
  if (!versions.length) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <h2 className="text-[18px] font-semibold">No narrative yet</h2>
        <p className="mt-2 text-[14px] text-muted">Complete Q1–Q4, resolve parse issues and click Generate narrative on the Purpose & red flags step.</p>
        <Button asChild variant="primary" className="mt-5">
          <Link href={`/cases/${c.id}/purpose`}>Go to Purpose & red flags</Link>
        </Button>
      </div>
    );
  }
  const [diff, audit, blockers] = await Promise.all([narrativeDiff(c.id), caseAudit(c.id, 5), approveBlockers(c)]);
  const latest = versions[versions.length - 1];
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <NarrativeWorkspace
        key={c.status}
        caseId={c.id}
        initialDoc={latest.contentJson as PMDoc}
        aiDraft={versions[0].contentJson as PMDoc}
        diff={diff!}
        locked={readOnly}
      />
      <div className="space-y-6">
        <DispositionPanel
          caseId={c.id}
          disposition={c.disposition}
          rationale={c.rationale}
          locked={readOnly}
          blockers={blockers}
          canUnlock
          approvedLabel={c.approvedAt ? `Approved ${formatDate(c.approvedAt.toISOString().slice(0, 10))} ${hhmm(c.approvedAt.toISOString())} UTC` : null}
        />
        <ExportPanel caseId={c.id} />
        <AuditPanel caseId={c.id} items={audit.map((a) => ({ id: a.id, at: hhmm(a.at), text: a.text }))} />
      </div>
    </div>
  );
}
