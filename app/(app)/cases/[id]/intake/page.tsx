import { loadAnalystCase } from "@/lib/cases/page";
import { listSubAlerts } from "@/lib/cases/service";
import { getFields } from "@/lib/cases/fields";
import { periodStats } from "@/lib/cases/transactions";
import { listDocuments } from "@/lib/documents/service";
import { listIssues } from "@/lib/documents/issues";
import { demoSetFor } from "@/lib/documents/demo";
import { canViewFullAccount } from "@/lib/auth/guard";
import { storageMode } from "@/lib/storage";
import { IntakeScreen } from "@/components/intake/intake-screen";

export const metadata = { title: "Alert & documents · TM Summary Drafter" };

export default async function IntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { user, c, readOnly } = await loadAnalystCase((await params).id);
  const [subAlerts, fields, stats, documents, issues, demo] = await Promise.all([
    listSubAlerts(c.id),
    getFields(c.id, canViewFullAccount(user)),
    periodStats(c.id),
    listDocuments(c.id),
    listIssues(c.id),
    demoSetFor(c.alertNumber),
  ]);
  return (
    <IntakeScreen
      caseId={c.id}
      alertNumber={c.alertNumber}
      readOnly={readOnly}
      subAlerts={subAlerts.map((s) => ({ ...s, isAi: s.aiValue != null }))}
      fields={fields.filter((f) => f.question === "q1" || f.question === "q2")}
      reviewStart={c.reviewStart}
      reviewEnd={c.reviewEnd}
      stats={stats}
      documents={documents}
      issues={issues}
      uploadMode={storageMode()}
      demoFiles={demo}
    />
  );
}
