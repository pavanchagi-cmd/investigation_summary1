import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, counterparties, documents, scenarioFindings, transactions } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { counterpartyKey } from "@/lib/ranking/keys";
import { maskAccount } from "@/lib/mask";

/** Structured input for Gemini call 3 (one call for the top 6). Analyst-edited values win over AI values. */
export async function buildQ5Input(caseId: number) {
  const db = await getDb();
  const cfg = await getConfig();
  const top = await db
    .select()
    .from(counterparties)
    .where(and(eq(counterparties.caseId, caseId), eq(counterparties.inTop6, true), eq(counterparties.stale, false)))
    .orderBy(asc(counterparties.rank));
  const fields = await db.select().from(caseFields).where(and(eq(caseFields.caseId, caseId), eq(caseFields.question, "q3")));
  const kyc = Object.fromEntries(fields.map((f) => [f.fieldKey, f.analystValue ?? f.aiValue ?? "not provided in the documents"]));
  if (kyc.accounts && Array.isArray(kyc.accounts)) {
    kyc.accounts = (kyc.accounts as { account_number: string; opened_date: string | null }[]).map((a) => ({ ...a, account_number: maskAccount(a.account_number) }));
  }
  const txns = await db
    .select({ t: transactions, fileName: documents.fileName })
    .from(transactions)
    .innerJoin(documents, eq(documents.id, transactions.documentId))
    .where(and(eq(transactions.caseId, caseId), eq(transactions.inPeriod, true)));
  const findings = await db.select().from(scenarioFindings).where(eq(scenarioFindings.caseId, caseId));
  const allDocs = await db.select().from(documents).where(eq(documents.caseId, caseId));
  const typeOf = (d: (typeof allDocs)[number]) => d.confirmedType ?? d.detectedType;

  const details = allDocs
    .filter((d) => typeOf(d) === "counterparty_details")
    .flatMap((d) => {
      const ex = d.extraction as { rows?: { name: string; account: string | null; relationship: string | null; notes: string | null; row?: number }[] } | null;
      return (ex?.rows ?? []).map((r) => ({ ...r, file: d.fileName }));
    });
  const rfi = allDocs
    .filter((d) => typeOf(d) === "rfi_response")
    .flatMap((d) => {
      const ex = d.extraction as { data?: { items?: { question: string | null; answer: string | null; counterparty: string | null; page: number | null }[] } } | null;
      return (ex?.data?.items ?? []).map((i) => ({ ...i, file: d.fileName }));
    });

  return {
    client_kyc: {
      client_name: kyc.client_name,
      nature_of_business: kyc.nature_of_business,
      expected_activity: kyc.expected_activity,
      incorporation_country: kyc.incorporation_country,
    },
    counterparties: top.map((c) => {
      const mine = txns.filter(({ t }) => counterpartyKey(t.counterpartyName, t.counterpartyAccount, cfg.legal_suffixes) === c.key);
      const ids = new Set(mine.map(({ t }) => t.id));
      const rows = mine.map(({ t }) => Number(t.sourceRow.replace(/\D/g, ""))).filter(Number.isFinite);
      const file = mine[0]?.fileName;
      const refs = new Map<string, number>();
      for (const { t } of mine) if (t.referenceText) refs.set(t.referenceText, (refs.get(t.referenceText) ?? 0) + 1);
      const detail = details.find((d) => d.name.toLowerCase() === c.name.toLowerCase());
      return {
        counterpartyId: c.id,
        name: c.name,
        account: maskAccount(c.account),
        direction_relative_to_client: c.direction === "sending" ? "sends funds to the client" : c.direction === "receiving" ? "receives funds from the client" : "both sends and receives",
        country: c.country,
        bank: c.bank,
        bank_country: c.bankCountry,
        txn_count: c.txnCount,
        total_amount: c.totalAmount,
        currency: cfg.fx_rates.base,
        pct_of_client_flow: c.pctOfFlow,
        first_date: c.firstDate,
        last_date: c.lastDate,
        risk_flags: c.flags,
        scenario_links: findings
          .filter((f) => f.matchedTxnIds.some((id) => ids.has(id)))
          .map((f) => ({ scenario: f.scenario, dismissed: f.dismissed, dismiss_reason: f.dismissReason, matched_txns_with_this_counterparty: f.matchedTxnIds.filter((id) => ids.has(id)).length })),
        reference_texts: [...refs.entries()].slice(0, 12).map(([text, count]) => ({ text, count })),
        stated_relationship: detail ? { relationship: detail.relationship, notes: detail.notes, source: `${detail.file} · row ${detail.row}` } : null,
        rfi_answers: rfi
          .filter((i) => i.counterparty && i.counterparty.toLowerCase() === c.name.toLowerCase())
          .map((i) => ({ question: i.question, answer: i.answer, source: `${i.file}${i.page ? ` · p.${i.page}` : ""}` })),
        transaction_source: file && rows.length ? `${file} · rows ${Math.min(...rows)}–${Math.max(...rows)}` : null,
      };
    }),
  };
}
export type Q5Input = Awaited<ReturnType<typeof buildQ5Input>>;
