import type { RuleContext, RuleTxn, ScenarioFinding } from "./types";
import { byDateThenId, daysBetween, dominantName, fmt, sum, uniqueSorted } from "./util";

/** Every maximal set of transactions whose dates fit in a window of `days` calendar days (inclusive). */
function windows(txns: RuleTxn[], days: number): RuleTxn[][] {
  const sorted = [...txns].sort(byDateThenId);
  const out: RuleTxn[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const group = sorted.filter((t, j) => j >= i && daysBetween(sorted[i].date, t.date) <= days - 1);
    out.push(group);
  }
  return out;
}

/**
 * Wire Structuring: (a) ≥ min_count wires in the near band (near_band_low–near_band_high of the
 * reporting threshold) within window_days; (b) split payments: ≥ 2 outgoing wires to the same
 * beneficiary within window_days, each below the threshold, together above it.
 */
export function wireStructuring(ctx: RuleContext): ScenarioFinding | null {
  const p = ctx.params;
  const wires = ctx.period.filter((t) => t.type === "wire");
  const low = p.reporting_threshold * p.near_band_low;
  const high = p.reporting_threshold * p.near_band_high;

  const near = wires.filter((t) => t.amount >= low && t.amount <= high);
  const nearMatched = new Map<number, RuleTxn>();
  for (const w of windows(near, p.window_days)) if (w.length >= p.min_count) w.forEach((t) => nearMatched.set(t.id, t));

  const splitMatched = new Map<number, RuleTxn>();
  const byBeneficiary = new Map<string, RuleTxn[]>();
  for (const t of wires) {
    if (t.direction !== "outgoing" || t.amount >= p.reporting_threshold) continue;
    byBeneficiary.set(t.cpKey, [...(byBeneficiary.get(t.cpKey) ?? []), t]);
  }
  for (const list of byBeneficiary.values()) {
    for (const w of windows(list, p.window_days)) {
      if (w.length >= 2 && sum(w.map((t) => t.amount)) > p.reporting_threshold) w.forEach((t) => splitMatched.set(t.id, t));
    }
  }

  const matched = [...new Map([...nearMatched, ...splitMatched]).values()].sort(byDateThenId);
  if (!matched.length) return null;

  const parts: string[] = [];
  if (nearMatched.size) {
    const list = [...nearMatched.values()].sort(byDateThenId);
    const amounts = list.map((t) => t.amount);
    const to = dominantName(list);
    const span = daysBetween(list[0].date, list[list.length - 1].date) + 1;
    parts.push(
      `${list.length} wires of ${ctx.baseCcy} ${fmt(Math.min(...amounts))}–${fmt(Math.max(...amounts))}` +
        (to ? ` ${list.every((t) => t.direction === "outgoing") ? "to" : "with"} ${to}` : "") +
        ` within ${span} day${span === 1 ? "" : "s"}; total ${fmt(sum(amounts))}.`,
    );
  }
  const splitOnly = [...splitMatched.values()].filter((t) => !nearMatched.has(t.id));
  if (splitMatched.size) {
    const beneficiaries = new Set([...splitMatched.values()].map((t) => t.cpKey)).size;
    parts.push(
      splitOnly.length || !nearMatched.size
        ? `Split payments: ${splitMatched.size} wires below ${ctx.baseCcy} ${fmt(p.reporting_threshold)} to ${beneficiaries} beneficiar${beneficiaries === 1 ? "y" : "ies"} within ${p.window_days} days, together above the threshold.`
        : `The same wires also form split payments to one beneficiary above ${ctx.baseCcy} ${fmt(p.reporting_threshold)} in total.`,
    );
  }

  return {
    scenario: "wire_structuring",
    subtype: [nearMatched.size ? "near_threshold" : null, splitMatched.size ? "split_payments" : null].filter(Boolean).join(","),
    summary: parts.join(" "),
    matchedTxnIds: uniqueSorted(matched.map((t) => t.id)),
    metrics: {
      match_count: matched.length,
      near_threshold_count: nearMatched.size,
      split_payment_count: splitMatched.size,
      total_amount: sum(matched.map((t) => t.amount)),
    },
    params: {
      reporting_threshold: p.reporting_threshold,
      near_band_low: p.near_band_low,
      near_band_high: p.near_band_high,
      window_days: p.window_days,
      min_count: p.min_count,
    },
  };
}
