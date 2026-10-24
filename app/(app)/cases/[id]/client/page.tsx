import { eq } from "drizzle-orm";
import { loadAnalystCase } from "@/lib/cases/page";
import { ensureAnalysis } from "@/lib/cases/ensure-analysis";
import { getFields } from "@/lib/cases/fields";
import { listCounterparties } from "@/lib/analysis/queries";
import { canViewFullAccount } from "@/lib/auth/guard";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { cases } from "@/lib/db/schema";
import { ClientScreen } from "@/components/client/client-screen";

export const metadata = { title: "Client & counterparties · TM Summary Drafter" };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, c: initial, readOnly } = await loadAnalystCase((await params).id);
  await ensureAnalysis(initial, user.id);
  const db = await getDb();
  const [c] = await db.select().from(cases).where(eq(cases.id, initial.id));
  const [fields, cps, cfg] = await Promise.all([
    getFields(c.id, canViewFullAccount(user)),
    listCounterparties(c.id, canViewFullAccount(user)),
    getConfig(),
  ]);
  return (
    <ClientScreen
      caseId={c.id}
      readOnly={readOnly}
      fields={fields.filter((f) => f.question === "q3")}
      counterparties={cps}
      weights={cfg.ranking_weights}
      ownAccount={c.analysisMeta?.ownAccount ?? null}
      baseCcy={cfg.fx_rates.base}
    />
  );
}
