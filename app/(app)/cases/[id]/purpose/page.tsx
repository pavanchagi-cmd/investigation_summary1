import { and, asc, eq } from "drizzle-orm";
import { loadAnalystCase } from "@/lib/cases/page";
import { ensureAnalysis } from "@/lib/cases/ensure-analysis";
import { getProgress } from "@/lib/cases/progress";
import { listFindings } from "@/lib/analysis/queries";
import { periodStats } from "@/lib/cases/transactions";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { cases, counterparties, relationshipSummaries } from "@/lib/db/schema";
import { Q5Cards, type Q5View } from "@/components/purpose/q5-cards";
import { RedFlagsPanel } from "@/components/purpose/red-flags";
import { GenerateNarrativeButton } from "@/components/purpose/generate-button";

export const metadata = { title: "Purpose & red flags · TM Summary Drafter" };

export default async function PurposePage({ params }: { params: Promise<{ id: string }> }) {
  const { user, c: initial, readOnly } = await loadAnalystCase((await params).id);
  await ensureAnalysis(initial, user.id);
  const db = await getDb();
  const [c] = await db.select().from(cases).where(eq(cases.id, initial.id));
  const [top, sums, findings, stats, progress, cfg] = await Promise.all([
    db
      .select()
      .from(counterparties)
      .where(and(eq(counterparties.caseId, c.id), eq(counterparties.inTop6, true), eq(counterparties.stale, false)))
      .orderBy(asc(counterparties.rank)),
    db.select().from(relationshipSummaries).where(eq(relationshipSummaries.caseId, c.id)),
    listFindings(c.id),
    periodStats(c.id),
    getProgress(c),
    getConfig(),
  ]);
  const items: Q5View[] = top.map((t, i) => {
    const s = sums.find((x) => x.counterpartyId === t.id);
    return {
      counterpartyId: t.id,
      rank: i + 1,
      name: t.name,
      summary: s
        ? {
            id: s.id,
            relationshipType: s.relationshipType,
            relationshipSubtype: s.relationshipSubtype,
            kycFit: s.kycFit,
            aiText: s.aiText,
            analystText: s.analystText,
            sources: s.sources,
            reviewStatus: s.reviewStatus,
          }
        : null,
    };
  });

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Q5Cards caseId={c.id} items={items} readOnly={readOnly} />
      <RedFlagsPanel
        caseId={c.id}
        findings={findings}
        checkedCount={stats.inPeriod}
        readOnly={readOnly}
        baseCcy={cfg.fx_rates.base}
        footer={<GenerateNarrativeButton caseId={c.id} blockers={progress.narrativeBlockers} hasNarrative={progress.hasNarrative} readOnly={readOnly} emptySubAlerts={progress.emptySubAlerts} />}
      />
    </div>
  );
}
