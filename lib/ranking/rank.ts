import type { RankingWeights } from "@/lib/config/schema";
import type { ScenarioKey } from "@/lib/rules/types";

export type RankTxn = {
  id: number;
  date: string;
  direction: "incoming" | "outgoing";
  amount: number; // base currency
  cpKey: string;
  cpName: string;
  account: string | null;
  bank: string | null;
  bankCountry: string | null;
  originatorCountry: string | null;
  beneficiaryCountry: string | null;
};

export type RankInput = {
  txns: RankTxn[];
  weights: RankingWeights;
  highRisk: Set<string>;
  weakReg: Set<string>;
  institutionKeywords: string[];
  /** Matched transaction ids per scenario, and the label used for it (rule ID such as "PF-11", or a short code). */
  scenarioLinks: { scenario: ScenarioKey; label: string; txnIds: Set<number> }[];
  /** Client's own accounts / name: excluded from ranking (DECISIONS S4). */
  isOwnAccount: (t: RankTxn) => boolean;
};

export type RankedCounterparty = {
  key: string;
  name: string;
  rawNames: string[];
  account: string | null;
  bank: string | null;
  bankCountry: string | null;
  country: string | null;
  direction: "sending" | "receiving" | "both";
  txnCount: number;
  totalAmount: number;
  pctOfFlow: number; // 0–100
  firstDate: string;
  lastDate: string;
  countries: string[];
  score: number;
  scoreBreakdown: {
    amount: number;
    high_risk: number;
    weak_reg: number;
    weights: RankingWeights;
    high_risk_countries: string[];
    weak_reg_countries: string[];
    institution_indicators: string[];
  };
  flags: string[];
  scenarios: { scenario: ScenarioKey; label: string; count: number }[];
  reason: string;
  rank: number;
};

function mostCommon<T>(values: (T | null)[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, c] of counts) if (c > n) [best, n] = [k, c];
  return best;
}

const ordinal = (n: number) => (n === 1 ? "Largest" : n === 2 ? "2nd largest" : n === 3 ? "3rd largest" : `${n}th largest`);

/**
 * Pure ranking (spec section 8): score = 100 × (w_amount·amount + w_high_risk·high_risk + w_weak_reg·weak_reg),
 * sorted by score, then total amount, then transaction count (then name for a stable order).
 */
export function rankCounterparties(input: RankInput): { ranked: RankedCounterparty[]; clientTotalFlow: number; ownAccount: { count: number; total: number } } {
  const clientTotalFlow = input.txns.reduce((s, t) => s + t.amount, 0);
  const own = input.txns.filter(input.isOwnAccount);
  const groups = new Map<string, RankTxn[]>();
  for (const t of input.txns) {
    if (input.isOwnAccount(t)) continue;
    groups.set(t.cpKey, [...(groups.get(t.cpKey) ?? []), t]);
  }

  const base = [...groups.entries()].map(([key, list]) => {
    const total = Math.round(list.reduce((s, t) => s + t.amount, 0) * 100) / 100;
    const dirs = new Set(list.map((t) => t.direction));
    const countries = new Set<string>();
    for (const t of list) {
      for (const c of [t.bankCountry, t.originatorCountry, t.beneficiaryCountry]) if (c) countries.add(c);
    }
    const name = mostCommon(list.map((t) => t.cpName)) ?? key;
    const bank = mostCommon(list.map((t) => t.bank));
    const country =
      mostCommon(list.map((t) => (t.direction === "incoming" ? t.originatorCountry : t.beneficiaryCountry))) ?? mostCommon(list.map((t) => t.bankCountry));
    const hay = `${name} ${bank ?? ""}`.toLowerCase();
    const indicators = input.institutionKeywords.filter((k) => new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay));
    if (list.every((t) => !t.bank)) indicators.push("no bank stated");
    const highRiskCountries = [...countries].filter((c) => input.highRisk.has(c)).sort();
    const weakRegCountries = [...countries].filter((c) => input.weakReg.has(c)).sort();
    const dates = list.map((t) => t.date).sort();
    return {
      key,
      list,
      name,
      rawNames: [...new Set(list.map((t) => t.cpName))].sort(),
      account: mostCommon(list.map((t) => t.account)),
      bank,
      bankCountry: mostCommon(list.map((t) => t.bankCountry)),
      country,
      direction: (dirs.size === 2 ? "both" : dirs.has("incoming") ? "sending" : "receiving") as RankedCounterparty["direction"],
      txnCount: list.length,
      totalAmount: total,
      firstDate: dates[0],
      lastDate: dates[dates.length - 1],
      countries: [...countries].sort(),
      highRiskCountries,
      weakRegCountries,
      indicators,
    };
  });

  const maxTotal = Math.max(0, ...base.map((b) => b.totalAmount));
  const byAmount = [...base].sort((a, b) => b.totalAmount - a.totalAmount || a.name.localeCompare(b.name));
  const amountRank = new Map(byAmount.map((b, i) => [b.key, i + 1]));
  const w = input.weights;

  const scored = base.map((b) => {
    const amount = maxTotal > 0 ? b.totalAmount / maxTotal : 0;
    const highRisk = b.highRiskCountries.length ? 1 : 0;
    const weakReg = b.weakRegCountries.length || b.indicators.length ? 1 : 0;
    const score = Math.round(100 * (w.amount * amount + w.high_risk * highRisk + w.weak_reg * weakReg) * 100) / 100;
    const ids = new Set(b.list.map((t) => t.id));
    const scenarios = input.scenarioLinks
      .map((s) => ({ scenario: s.scenario, label: s.label, count: [...s.txnIds].filter((id) => ids.has(id)).length }))
      .filter((s) => s.count > 0);
    const flags = [
      ...scenarios.map((s) => s.label),
      ...(highRisk ? ["High-risk list"] : []),
      ...(b.weakRegCountries.length ? ["Weak reg."] : []),
      ...b.indicators.map((i) => (i === "no bank stated" ? "No bank stated" : `Indicator: ${i}`)),
    ];
    const pctOfFlow = clientTotalFlow > 0 ? (b.totalAmount / clientTotalFlow) * 100 : 0;
    const ar = amountRank.get(b.key)!;
    const reasons: string[] = [];
    if (ar <= 3) reasons.push(`${ordinal(ar)} flow (${pctOfFlow.toFixed(1)}%)`);
    if (highRisk) reasons.push(`high-risk country ${b.highRiskCountries.join(", ")}`);
    if (b.weakRegCountries.length) reasons.push(`weakly regulated jurisdiction ${b.weakRegCountries.join(", ")}`);
    if (b.indicators.length) reasons.push(b.indicators.map((i) => (i === "no bank stated" ? "no bank stated" : `"${i}" indicator`)).join(", "));
    for (const s of scenarios) reasons.push(`linked to ${s.label} (${s.count} txn${s.count === 1 ? "" : "s"})`);
    if (!reasons.length) reasons.push(`${pctOfFlow.toFixed(1)}% of flow`);
    const reason = reasons.join("; ");
    return {
      key: b.key,
      name: b.name,
      rawNames: b.rawNames,
      account: b.account,
      bank: b.bank,
      bankCountry: b.bankCountry,
      country: b.country,
      direction: b.direction,
      txnCount: b.txnCount,
      totalAmount: b.totalAmount,
      pctOfFlow: Math.round(pctOfFlow * 10) / 10,
      firstDate: b.firstDate,
      lastDate: b.lastDate,
      countries: b.countries,
      score,
      scoreBreakdown: {
        amount: Math.round(amount * 10000) / 10000,
        high_risk: highRisk,
        weak_reg: weakReg,
        weights: w,
        high_risk_countries: b.highRiskCountries,
        weak_reg_countries: b.weakRegCountries,
        institution_indicators: b.indicators,
      },
      flags,
      scenarios,
      reason: reason.charAt(0).toUpperCase() + reason.slice(1),
      rank: 0,
    };
  });

  scored.sort((a, b) => b.score - a.score || b.totalAmount - a.totalAmount || b.txnCount - a.txnCount || a.name.localeCompare(b.name));
  scored.forEach((s, i) => (s.rank = i + 1));
  return {
    ranked: scored,
    clientTotalFlow: Math.round(clientTotalFlow * 100) / 100,
    ownAccount: { count: own.length, total: Math.round(own.reduce((s, t) => s + t.amount, 0) * 100) / 100 },
  };
}

/**
 * Applies analyst swaps to the default top 6: each swapped-in counterparty replaces the one
 * recorded in `swappedFor`, if both still exist. Always exactly min(6, n).
 */
export function topSix(ranked: { key: string; rank: number }[], swaps: { inKey: string; outKey: string }[]): Set<string> {
  const top = ranked.filter((r) => r.rank <= 6).map((r) => r.key);
  const exists = new Set(ranked.map((r) => r.key));
  for (const s of swaps) {
    if (!exists.has(s.inKey) || top.includes(s.inKey)) continue;
    const idx = top.indexOf(s.outKey);
    if (idx >= 0) top[idx] = s.inKey;
  }
  return new Set(top);
}
