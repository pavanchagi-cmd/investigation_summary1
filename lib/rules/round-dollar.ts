import type { RuleContext, RuleTxn, ScenarioFinding } from "./types";
import { fmt, pct, sum } from "./util";

export function isRound(amount: number, unit: number) {
  return Math.round(amount * 100) % Math.round(unit * 100) === 0;
}

/**
 * Round Dollar Transaction: amount modulo round_unit = 0. Reports count and % of transactions and
 * % of value by direction; fires for a direction when its count % ≥ round_pct_alert (DECISIONS S5, I6).
 */
export function roundDollar(ctx: RuleContext): ScenarioFinding | null {
  const { round_unit: unit, round_pct_alert: alertPct } = ctx.params;
  const metrics: Record<string, number> = {};
  const matched: RuleTxn[] = [];
  const sentences: string[] = [];
  const fired: string[] = [];

  for (const dir of ["outgoing", "incoming"] as const) {
    const all = ctx.period.filter((t) => t.direction === dir);
    const round = all.filter((t) => isRound(t.amount, unit));
    const countPct = all.length ? round.length / all.length : 0;
    const valuePct = all.length ? sum(round.map((t) => t.amount)) / (sum(all.map((t) => t.amount)) || 1) : 0;
    metrics[`${dir}_count`] = all.length;
    metrics[`${dir}_round_count`] = round.length;
    metrics[`${dir}_round_count_pct`] = Math.round(countPct * 1000) / 10;
    metrics[`${dir}_round_value_pct`] = Math.round(valuePct * 1000) / 10;
    if (all.length && countPct >= alertPct) {
      fired.push(dir);
      matched.push(...round);
      sentences.push(
        `${round.length} of ${all.length} ${dir} (${pct(countPct)}) are exact multiples of ${fmt(unit)}; ${pct(valuePct)} of ${dir} value.`,
      );
    }
  }
  if (!matched.length) return null;
  metrics.match_count = matched.length;
  return {
    scenario: "round_dollar",
    subtype: fired.join(","),
    summary: sentences.join(" "),
    matchedTxnIds: matched.map((t) => t.id).sort((a, b) => a - b),
    metrics,
    params: { round_unit: unit, round_pct_alert: alertPct },
  };
}
