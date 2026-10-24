import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, cases, counterparties, relationshipSummaries, scenarioFindings, subAlerts, transactions } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { maskAccount, maskAccountsInText } from "@/lib/mask";

const MAX_TXNS = 2000;

/**
 * Narrative input JSON (spec section 9, call 4). Analyst-edited values are used wherever they exist.
 * Account numbers are masked, so the narrative can never contain a full account number.
 */
export async function buildNarrativeInput(caseId: number) {
  const db = await getDb();
  const cfg = await getConfig();
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  const [subs, fields, cps, sums, findings, txns] = await Promise.all([
    db.select().from(subAlerts).where(eq(subAlerts.caseId, caseId)).orderBy(asc(subAlerts.subAlertNumber)),
    db.select().from(caseFields).where(eq(caseFields.caseId, caseId)),
    db
      .select()
      .from(counterparties)
      .where(and(eq(counterparties.caseId, caseId), eq(counterparties.inTop6, true), eq(counterparties.stale, false)))
      .orderBy(asc(counterparties.rank)),
    db.select().from(relationshipSummaries).where(eq(relationshipSummaries.caseId, caseId)),
    db.select().from(scenarioFindings).where(eq(scenarioFindings.caseId, caseId)),
    db.select().from(transactions).where(eq(transactions.caseId, caseId)).orderBy(asc(transactions.date), asc(transactions.id)),
  ]);
  const value = (q: string, k: string) => {
    const f = fields.find((x) => x.question === q && x.fieldKey === k);
    return f ? (f.analystValue ?? f.aiValue ?? null) : null;
  };
  const kyc: Record<string, unknown> = {};
  for (const f of fields.filter((x) => x.question === "q3")) {
    let v = f.analystValue ?? f.aiValue ?? null;
    if (f.fieldKey === "accounts" && Array.isArray(v)) {
      v = (v as { account_number: string; opened_date: string | null }[]).map((a) => ({ ...a, account_number: maskAccount(a.account_number) }));
    } else if (typeof v === "string") v = maskAccountsInText(v);
    kyc[f.fieldKey] = v ?? "not provided in the documents";
  }

  const inPeriod = txns.filter((t) => t.inPeriod);
  const total = Math.round(inPeriod.reduce((s, t) => s + t.amountBaseCcy, 0) * 100) / 100;
  const txnView = (t: (typeof txns)[number]) => ({
    id: t.id,
    date: t.date,
    transaction_id: t.transactionId,
    direction: t.direction,
    amount: t.amount,
    currency: t.currency,
    amount_base: t.amountBaseCcy,
    type: t.type,
    counterparty: t.counterpartyName,
    counterparty_account: maskAccount(t.counterpartyAccount),
    counterparty_bank_country: t.counterpartyBankCountry,
    reference: t.referenceText ? maskAccountsInText(t.referenceText) : null,
  });

  let transactionsInPeriod: unknown[];
  let note = "";
  if (inPeriod.length > MAX_TXNS) {
    const matched = new Set(findings.flatMap((f) => f.matchedTxnIds));
    const months = new Map<string, { month: string; incoming_count: number; incoming_total: number; outgoing_count: number; outgoing_total: number }>();
    for (const t of inPeriod) {
      const m = t.date.slice(0, 7);
      const row = months.get(m) ?? { month: m, incoming_count: 0, incoming_total: 0, outgoing_count: 0, outgoing_total: 0 };
      if (t.direction === "incoming") {
        row.incoming_count++;
        row.incoming_total += t.amountBaseCcy;
      } else {
        row.outgoing_count++;
        row.outgoing_total += t.amountBaseCcy;
      }
      months.set(m, row);
    }
    transactionsInPeriod = [
      ...inPeriod.filter((t) => matched.has(t.id)).map(txnView),
      { monthly_aggregates: [...months.values()] },
    ];
    note = `The review period has ${inPeriod.length} transactions (more than ${MAX_TXNS}); only transactions matched by scenario findings are listed individually, with monthly aggregates for all transactions.`;
  } else {
    transactionsInPeriod = inPeriod.map(txnView);
  }

  return {
    alert: { alert_number: c.alertNumber, alert_date: value("q1", "alert_date") },
    sub_alerts: subs.map((s) => ({
      sub_alert_number: s.subAlertNumber,
      scenario: s.scenario,
      rule_id: s.ruleId,
      threshold: s.threshold,
      trigger_details: s.triggerDetails,
      triggering_txn_count: s.triggeringTxnCount,
    })),
    review_period: {
      start: c.reviewStart,
      end: c.reviewEnd,
      in_period_txn_count: inPeriod.length,
      excluded_txn_count: txns.length - inPeriod.length,
      total_flow: total,
      currency: cfg.fx_rates.base,
    },
    client_kyc: kyc,
    counterparties_top6: cps.map((p) => ({
      name: p.name,
      account: maskAccount(p.account),
      direction: p.direction === "sending" ? "sends funds to the client" : p.direction === "receiving" ? "receives funds from the client" : "both sends and receives",
      country: p.country,
      bank: p.bank,
      bank_country: p.bankCountry,
      txn_count: p.txnCount,
      total_amount: p.totalAmount,
      pct_of_client_flow: p.pctOfFlow,
      first_date: p.firstDate,
      last_date: p.lastDate,
      flags: p.flags,
      reason_ranked: p.reason,
      analyst_swap_reason: p.swappedReason,
    })),
    relationship_summaries: cps.map((p) => {
      const s = sums.find((x) => x.counterpartyId === p.id);
      return {
        counterparty: p.name,
        relationship_type: s?.relationshipType ?? null,
        kyc_fit: s?.kycFit ?? null,
        summary: s ? (s.analystText ?? s.aiText) : "not provided",
        review_status: s?.reviewStatus ?? null,
      };
    }),
    scenario_findings: findings.map((f) => ({
      scenario: f.scenario,
      summary: f.summary,
      matched_count: f.matchedTxnIds.length,
      matched_transaction_ids: f.matchedTxnIds,
      metrics: f.metrics,
      params: f.params,
      dismissed: f.dismissed,
      dismiss_reason: f.dismissReason,
    })),
    transactions_in_period: transactionsInPeriod,
    analyst_notes: note,
  };
}
export type NarrativeInput = Awaited<ReturnType<typeof buildNarrativeInput>>;
