import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, cases, counterparties, scenarioFindings, subAlerts, transactions, type Transaction } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { logAudit } from "@/lib/audit/log";
import { runRules, type RuleTxn, type ScenarioKey } from "@/lib/rules";
import { counterpartyKey, normaliseAccount, normaliseName } from "@/lib/ranking/keys";
import { rankCounterparties, topSix, type RankTxn } from "@/lib/ranking/rank";

const SHORT: Record<ScenarioKey, string> = {
  large_amount: "LA",
  pattern_of_funds: "PF",
  round_dollar: "RD",
  wire_structuring: "WS",
};

/** Reads a monthly value from the KYC expected-activity field (AI object, or analyst text such as "USD 500k / month"). */
export function expectedMonthlyValue(v: unknown): number | null {
  if (v && typeof v === "object" && "monthly_value" in v) {
    const n = (v as { monthly_value: unknown }).monthly_value;
    return typeof n === "number" && n > 0 ? n : null;
  }
  if (typeof v === "string") {
    const m = v.match(/[A-Z]{3}\s*([\d,.]+)\s*([km])?\b/i);
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, "")) * (m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

/** Scenario rules + ranking for one case (POST /api/cases/[id]/analyse). Preserves dismissals and swaps. */
export async function runAnalysis(caseId: number, actorId: number | null) {
  const db = await getDb();
  const cfg = await getConfig();
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) throw new Error("Case not found");
  const txns = await db.select().from(transactions).where(eq(transactions.caseId, caseId));
  const fields = await db.select().from(caseFields).where(and(eq(caseFields.caseId, caseId), eq(caseFields.question, "q3")));
  const val = (k: string) => {
    const f = fields.find((x) => x.fieldKey === k);
    return f ? (f.analystValue ?? f.aiValue) : null;
  };
  const subs = await db.select().from(subAlerts).where(eq(subAlerts.caseId, caseId));
  const suffixes = cfg.legal_suffixes;

  const key = (t: Transaction) => counterpartyKey(t.counterpartyName, t.counterpartyAccount, suffixes);
  const toRule = (t: Transaction): RuleTxn => ({
    id: t.id,
    date: t.date,
    direction: t.direction,
    amount: t.amountBaseCcy,
    type: t.type,
    cpKey: key(t),
    cpName: t.counterpartyName ?? "(no name)",
    account: normaliseAccount(t.counterpartyAccount),
  });
  const period = txns.filter((t) => t.inPeriod);
  const history = txns.filter((t) => !t.inPeriod);

  const findings =
    c.reviewStart && c.reviewEnd
      ? runRules({
          period: period.map(toRule),
          history: history.map(toRule),
          periodStart: c.reviewStart,
          periodEnd: c.reviewEnd,
          kycExpectedMonthlyValue: expectedMonthlyValue(val("expected_activity")),
          params: cfg.rules,
          baseCcy: cfg.fx_rates.base,
        })
      : [];

  // Findings: update in place (keeps dismissals), insert new, remove scenarios that no longer fire.
  const existing = await db.select().from(scenarioFindings).where(eq(scenarioFindings.caseId, caseId));
  for (const f of findings) {
    const row = existing.find((e) => e.scenario === f.scenario);
    const values = {
      subtype: f.subtype ?? "",
      summary: f.summary,
      matchedTxnIds: f.matchedTxnIds,
      metrics: f.metrics,
      params: f.params,
    };
    if (row) await db.update(scenarioFindings).set(values).where(eq(scenarioFindings.id, row.id));
    else await db.insert(scenarioFindings).values({ caseId, scenario: f.scenario, ...values });
  }
  for (const e of existing) if (!findings.some((f) => f.scenario === e.scenario)) await db.delete(scenarioFindings).where(eq(scenarioFindings.id, e.id));

  // Ranking.
  const clientName = typeof val("client_name") === "string" ? normaliseName(String(val("client_name")), suffixes) : null;
  const accountsVal = val("accounts");
  const ownAccounts = new Set(
    (Array.isArray(accountsVal) ? (accountsVal as { account_number?: string }[]).map((a) => a.account_number) : [])
      .map((a) => normaliseAccount(a))
      .filter((a): a is string => !!a),
  );
  const rankTxns: RankTxn[] = period.map((t) => ({
    id: t.id,
    date: t.date,
    direction: t.direction,
    amount: t.amountBaseCcy,
    cpKey: key(t),
    cpName: t.counterpartyName ?? "(no name)",
    account: t.counterpartyAccount,
    bank: t.counterpartyBank,
    bankCountry: t.counterpartyBankCountry,
    originatorCountry: t.originatorCountry,
    beneficiaryCountry: t.beneficiaryCountry,
  }));
  const label = (s: ScenarioKey) => subs.find((x) => x.scenario === s && x.ruleId)?.ruleId ?? SHORT[s];
  const { ranked, clientTotalFlow, ownAccount } = rankCounterparties({
    txns: rankTxns,
    weights: cfg.ranking_weights,
    highRisk: new Set(cfg.high_risk_countries.map((x) => x.code)),
    weakReg: new Set(cfg.weak_regulation_countries.map((x) => x.code)),
    institutionKeywords: cfg.institution_risk_keywords,
    scenarioLinks: findings.map((f) => ({ scenario: f.scenario, label: label(f.scenario), txnIds: new Set(f.matchedTxnIds) })),
    isOwnAccount: (t) => {
      const acc = normaliseAccount(t.account);
      if (acc && ownAccounts.has(acc)) return true;
      return !!clientName && normaliseName(t.cpName, suffixes) === clientName;
    },
  });

  const prior = await db.select().from(counterparties).where(eq(counterparties.caseId, caseId));
  const swaps = prior.filter((p) => p.swappedFor).map((p) => ({ inKey: p.key, outKey: p.swappedFor! }));
  const top = topSix(ranked, swaps);
  for (const r of ranked) {
    const values = {
      name: r.name,
      rawNames: r.rawNames,
      account: r.account,
      bank: r.bank,
      bankCountry: r.bankCountry,
      country: r.country,
      direction: r.direction,
      txnCount: r.txnCount,
      totalAmount: r.totalAmount,
      pctOfFlow: r.pctOfFlow,
      firstDate: r.firstDate,
      lastDate: r.lastDate,
      score: r.score,
      scoreBreakdown: { ...r.scoreBreakdown, scenarios: r.scenarios, countries: r.countries },
      flags: r.flags,
      reason: r.reason,
      rank: r.rank,
      inTop6: top.has(r.key),
      stale: false,
    };
    const row = prior.find((p) => p.key === r.key);
    if (row) await db.update(counterparties).set(values).where(eq(counterparties.id, row.id));
    else await db.insert(counterparties).values({ caseId, key: r.key, ...values });
  }
  for (const p of prior) {
    if (!ranked.some((r) => r.key === p.key)) {
      await db.update(counterparties).set({ stale: true, inTop6: false }).where(eq(counterparties.id, p.id));
    }
  }

  await db
    .update(cases)
    .set({ needsAnalysis: false, analysedAt: new Date(), analysisMeta: { clientTotalFlow, ownAccount } })
    .where(eq(cases.id, caseId));
  await logAudit({
    caseId,
    actorId,
    action: "analysis_run",
    entity: "case",
    entityId: caseId,
    after: {
      in_period_txns: period.length,
      findings: findings.map((f) => ({ scenario: f.scenario, matches: f.matchedTxnIds.length })),
      counterparties: ranked.length,
      params: cfg.rules,
      weights: cfg.ranking_weights,
    },
  });
  return { findings: findings.length, counterparties: ranked.length };
}
