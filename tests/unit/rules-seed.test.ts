import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type RuleParams } from "@/lib/config/schema";
import { readWorkbook } from "@/lib/parsing/spreadsheet";
import { normaliseTransactions, type NormalisedTxn } from "@/lib/parsing/normalise";
import { runRules, type RuleTxn, type ScenarioFinding } from "@/lib/rules";
import { largeAmount } from "@/lib/rules/large-amount";
import { roundDollar, isRound } from "@/lib/rules/round-dollar";
import { wireStructuring } from "@/lib/rules/wire-structuring";
import { circular, funnels, passThrough, volumeChange } from "@/lib/rules/pattern-of-funds";
import { counterpartyKey, normaliseAccount, normaliseName } from "@/lib/ranking/keys";
import { rankCounterparties, topSix } from "@/lib/ranking/rank";
import { buildSeedAlerts } from "@/lib/seed/alerts";
import { seedFileNames } from "@/lib/seed/fixtures";
import type { SeedAlert } from "@/lib/seed/types";

const suffixes = DEFAULT_CONFIG.legal_suffixes;

/** Parses a seed alert's generated XLSX through the real reader + normaliser. */
function loadSeed(a: SeedAlert) {
  const file = path.join(process.cwd(), "seed", "files", a.alertNumber, seedFileNames(a).transactions);
  const sheet = readWorkbook(fs.readFileSync(file));
  const res = normaliseTransactions(sheet.headers, sheet.rows, { documentId: 1, fx: DEFAULT_CONFIG.fx_rates, documentCurrency: "USD" });
  const toRule = (t: NormalisedTxn, i: number): RuleTxn => ({
    id: i + 1,
    date: t.date,
    direction: t.direction,
    amount: t.amountBaseCcy,
    type: t.type,
    cpKey: counterpartyKey(t.counterpartyName, t.counterpartyAccount, suffixes),
    cpName: t.counterpartyName ?? "(no name)",
    account: normaliseAccount(t.counterpartyAccount),
  });
  const all = res.txns.map(toRule);
  const inPeriod = (t: { date: string }) => t.date >= a.reviewStart && t.date <= a.reviewEnd;
  return {
    res,
    all,
    norm: res.txns,
    ctx: (params: RuleParams = DEFAULT_CONFIG.rules) => ({
      period: all.filter(inPeriod),
      history: all.filter((t) => !inPeriod(t)),
      periodStart: a.reviewStart,
      periodEnd: a.reviewEnd,
      kycExpectedMonthlyValue: a.client.expected.monthlyValue,
      params,
      baseCcy: "USD",
    }),
  };
}

const alerts = buildSeedAlerts();
const byNumber = (n: string) => alerts.find((a) => a.alertNumber === n)!;

describe.each(alerts.map((a) => [a.alertNumber, a] as const))("seed %s", (_n, a) => {
  const { res, ctx } = loadSeed(a);

  it("parses every row: valid rows become transactions, malformed rows become issues", () => {
    expect(res.missingColumns).toEqual([]);
    expect(res.txns).toHaveLength(a.txns.length);
    expect(new Set(res.issues.map((i) => i.sourceRowOrPage)).size).toBe(a.expected.malformedRows);
    expect(res.issues.map((i) => i.sourceRowOrPage).sort()).toEqual(a.malformed.map((m) => `row ${m.excelRow}`).sort());
    const c = ctx();
    expect(c.period).toHaveLength(a.expected.inPeriod);
    expect(c.history).toHaveLength(a.expected.excluded);
  });

  it("fires exactly the planted scenarios with the expected matches", () => {
    const findings = runRules(ctx());
    for (const [scenario, exp] of Object.entries(a.expected.findings)) {
      const f = findings.find((x) => x.scenario === scenario);
      expect(f, scenario).toBeDefined();
      expect(f!.matchedTxnIds).toHaveLength(exp!.matches);
      expect(f!.subtype!.split(",")).toEqual(exp!.subtypes);
    }
    for (const s of a.expected.notFiring) expect(findings.find((x) => x.scenario === s), s).toBeUndefined();
  });
});

describe("ALR-2026-000123 (design case)", () => {
  const a = byNumber("ALR-2026-000123");
  const { ctx, norm, all } = loadSeed(a);
  const findings = runRules(ctx());
  const get = (s: ScenarioFinding["scenario"]) => findings.find((f) => f.scenario === s)!;

  it("reproduces the design's red-flag findings", () => {
    expect(get("wire_structuring").summary).toBe(
      "7 wires of USD 9,500–9,950 to Pinewood Textiles within 6 days; total 68,900. The same wires also form split payments to one beneficiary above USD 10,000 in total.",
    );
    expect(get("pattern_of_funds").summary).toContain(
      "6 pass-through pairs: in from Harbourline Logistics FZE, out to Morrow Metals Ltd within ≤ 3 days, amounts within 2%.",
    );
    expect(get("pattern_of_funds").summary).toContain("Monthly volume up 2.4× versus prior 6-month average");
    expect(get("round_dollar").summary).toMatch(/^41 of 96 outgoing \(43%\) are exact multiples of 1,000;/);
    expect(get("round_dollar").metrics.outgoing_round_count_pct).toBe(42.7);
  });

  it("Large Amount fires on the 31 transactions of USD 50,000 or more (DECISIONS S8)", () => {
    const f = get("large_amount");
    expect(f.metrics.over_threshold_count).toBe(31);
    expect(f.metrics.over_multiple_count).toBe(0);
    expect(f.metrics.average_from_history).toBe(1);
  });

  it("total in-period flow matches the design (USD 4,142,880)", () => {
    expect(Math.round(ctx().period.reduce((s, t) => s + t.amount, 0) * 100) / 100).toBe(4_142_880);
  });

  it("ranks counterparties with the spec formula and keeps own accounts out", () => {
    const period = norm.filter((t) => t.date >= a.reviewStart && t.date <= a.reviewEnd);
    const ids = new Map(norm.map((t, i) => [t, i + 1]));
    const links = findings.map((f) => ({ scenario: f.scenario, label: { wire_structuring: "WS-04", round_dollar: "RD-02", pattern_of_funds: "PF-11", large_amount: "LA" }[f.scenario], txnIds: new Set(f.matchedTxnIds) }));
    const client = normaliseName(a.client.name, suffixes);
    const { ranked, ownAccount, clientTotalFlow } = rankCounterparties({
      txns: period.map((t) => ({
        id: ids.get(t)!,
        date: t.date,
        direction: t.direction,
        amount: t.amountBaseCcy,
        cpKey: counterpartyKey(t.counterpartyName, t.counterpartyAccount, suffixes),
        cpName: t.counterpartyName ?? "",
        account: t.counterpartyAccount,
        bank: t.counterpartyBank,
        bankCountry: t.counterpartyBankCountry,
        originatorCountry: t.originatorCountry,
        beneficiaryCountry: t.beneficiaryCountry,
      })),
      weights: DEFAULT_CONFIG.ranking_weights,
      highRisk: new Set(DEFAULT_CONFIG.high_risk_countries.map((c) => c.code)),
      weakReg: new Set(DEFAULT_CONFIG.weak_regulation_countries.map((c) => c.code)),
      institutionKeywords: DEFAULT_CONFIG.institution_risk_keywords,
      scenarioLinks: links,
      isOwnAccount: (t) => normaliseName(t.cpName, suffixes) === client,
    });
    expect(clientTotalFlow).toBe(4_142_880);
    expect(ownAccount).toEqual({ count: 2, total: 88_250 });
    expect(ranked).toHaveLength(19);
    expect(ranked.slice(0, 7).map((r) => [r.name, r.score])).toEqual([
      ["Aurelia Holdings S.A.", 67.94],
      ["Harbourline Logistics FZE", 60],
      ["Morrow Metals Ltd", 39.37],
      ["Velo Commodities LLC", 34.91],
      ["Orbis Trade Services MSB", 19.49],
      ["Pinewood Textiles", 19.17],
      ["R. Menon", 7.87],
    ]);
    const harbour = ranked.find((r) => r.name.startsWith("Harbourline"))!;
    expect(harbour).toMatchObject({ direction: "both", txnCount: 14, totalAmount: 1_284_000, pctOfFlow: 31 });
    expect(harbour.reason).toMatch(/^Largest flow \(31\.0%\); linked to PF-11 \(6 txns\)/);
    expect(ranked.find((r) => r.name === "Pinewood Textiles")).toMatchObject({ direction: "receiving", txnCount: 22, totalAmount: 410_300 });
    expect(ranked.find((r) => r.name === "Aurelia Holdings S.A.")!.flags).toEqual(expect.arrayContaining(["High-risk list", "Weak reg.", "Indicator: holdings"]));
    expect(ranked.find((r) => r.name === "Orbis Trade Services MSB")!.flags).toContain("Indicator: msb");

    // Swap keeps exactly six.
    const top = topSix(ranked, [{ inKey: ranked[6].key, outKey: ranked[4].key }]);
    expect(top.size).toBe(6);
    expect(top.has(ranked[6].key)).toBe(true);
    expect(top.has(ranked[4].key)).toBe(false);
  });

  it("changing a threshold changes the finding count", () => {
    const stricter = { ...DEFAULT_CONFIG.rules, large_amount_threshold: 100_000 };
    expect(largeAmount(ctx(stricter))!.matchedTxnIds.length).toBeLessThan(31);
    void all;
  });
});

describe("rule edge cases", () => {
  const p = DEFAULT_CONFIG.rules;
  const t = (id: number, date: string, direction: "incoming" | "outgoing", amount: number, cp = "A", type: RuleTxn["type"] = "wire"): RuleTxn => ({
    id,
    date,
    direction,
    amount,
    type,
    cpKey: cp.toLowerCase(),
    cpName: cp,
    account: null,
  });
  const ctx = (period: RuleTxn[], history: RuleTxn[] = []) => ({
    period,
    history,
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    kycExpectedMonthlyValue: null,
    params: p,
    baseCcy: "USD",
  });

  it("round detection respects cents", () => {
    expect(isRound(5000, 1000)).toBe(true);
    expect(isRound(5000.01, 1000)).toBe(false);
  });

  it("large amount falls back to the period median without history", () => {
    const f = largeAmount(ctx([t(1, "2026-07-01", "incoming", 100), t(2, "2026-07-02", "incoming", 200), t(3, "2026-07-03", "incoming", 700)]))!;
    expect(f.metrics.average_from_history).toBe(0);
    expect(f.matchedTxnIds).toEqual([3]);
  });

  it("pass-through uses a single debit first, else a run of debits", () => {
    const single = passThrough(ctx([t(1, "2026-07-01", "incoming", 10_000), t(2, "2026-07-03", "outgoing", 9_700, "B")]));
    expect(single).toHaveLength(1);
    const run = passThrough(ctx([t(1, "2026-07-01", "incoming", 10_000), t(2, "2026-07-02", "outgoing", 6_000, "B"), t(3, "2026-07-03", "outgoing", 4_100, "C")]));
    expect(run[0].debits.map((d) => d.id)).toEqual([2, 3]);
    const late = passThrough(ctx([t(1, "2026-07-01", "incoming", 10_000), t(2, "2026-07-05", "outgoing", 10_000, "B")]));
    expect(late).toHaveLength(0);
  });

  it("funnel, circular and volume change", () => {
    const fan = [1, 2, 3, 4, 5].map((i) => t(i, `2026-07-0${i}`, "incoming", 500, `P${i}`));
    expect(funnels(ctx(fan))[0]).toMatchObject({ direction: "incoming", parties: 5 });
    expect(funnels(ctx(fan.slice(0, 4)))).toHaveLength(0);
    expect(circular(ctx([t(1, "2026-07-01", "outgoing", 5_000, "X"), t(2, "2026-07-20", "incoming", 5_100, "X")]))).toHaveLength(1);
    expect(circular(ctx([t(1, "2026-07-01", "outgoing", 5_000, "X"), t(2, "2026-08-20", "incoming", 5_000, "X")]))).toHaveLength(0);
    const v = volumeChange({ ...ctx([t(1, "2026-07-01", "incoming", 300_000)]), kycExpectedMonthlyValue: 40_000 });
    expect(v.fired).toBe(true);
  });

  it("wire structuring: near band count and split payments", () => {
    const near = [t(1, "2026-08-01", "outgoing", 9_100, "P"), t(2, "2026-08-03", "incoming", 9_800, "Q"), t(3, "2026-08-07", "outgoing", 9_999, "R")];
    expect(wireStructuring(ctx(near))!.subtype).toBe("near_threshold");
    expect(wireStructuring(ctx([near[0], near[1], t(3, "2026-08-08", "outgoing", 9_999, "R")]))).toBeNull();
    const split = wireStructuring(ctx([t(1, "2026-08-01", "outgoing", 6_000, "S"), t(2, "2026-08-04", "outgoing", 5_000, "S")]))!;
    expect(split.subtype).toBe("split_payments");
    expect(wireStructuring(ctx([t(1, "2026-08-01", "outgoing", 6_000, "S", "ach"), t(2, "2026-08-04", "outgoing", 5_000, "S", "ach")]))).toBeNull();
  });

  it("round dollar fires per direction", () => {
    const out = [1, 2, 3, 4, 5].map((i) => t(i, "2026-07-01", "outgoing", i <= 2 ? 1000 * i : 1234.5));
    expect(roundDollar(ctx(out))!.matchedTxnIds).toEqual([1, 2]);
    expect(roundDollar(ctx(out.slice(1)))).toBeNull();
  });
});

describe("counterparty keys", () => {
  it("strips punctuation and legal suffixes, adds the account", () => {
    expect(normaliseName("Aurelia Holdings S.A.", suffixes)).toBe("aurelia holdings");
    expect(normaliseName("Kestrel Trading Pvt. Ltd.", suffixes)).toBe("kestrel trading");
    expect(normaliseName("Harbourline Logistics FZE", suffixes)).toBe("harbourline logistics");
    expect(counterpartyKey("Morrow Metals Ltd", "HK00 4881 2033 8803", suffixes)).toBe("morrow metals|HK00488120338803");
  });
});
