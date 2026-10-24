import type { RuleContext, ScenarioFinding } from "./types";
import { fmt, median, sum } from "./util";

/**
 * Large Amount Transaction: amount ≥ large_amount_threshold, or amount > large_vs_avg_multiple ×
 * the client's average transaction (history outside the period if any, else the period median).
 */
export function largeAmount(ctx: RuleContext): ScenarioFinding | null {
  const { large_amount_threshold: threshold, large_vs_avg_multiple: multiple } = ctx.params;
  const fromHistory = ctx.history.length > 0;
  const average = fromHistory ? sum(ctx.history.map((t) => t.amount)) / ctx.history.length : median(ctx.period.map((t) => t.amount));
  const overThreshold = ctx.period.filter((t) => t.amount >= threshold);
  const overMultiple = average > 0 ? ctx.period.filter((t) => t.amount > multiple * average) : [];
  const matched = [...new Map([...overThreshold, ...overMultiple].map((t) => [t.id, t])).values()];
  if (!matched.length) return null;

  const largest = Math.max(...matched.map((t) => t.amount));
  const basis = fromHistory ? `average of ${ctx.history.length} transactions outside the period` : "median of the period";
  const summary =
    `${matched.length} txn${matched.length === 1 ? "" : "s"} of ${ctx.baseCcy} ${fmt(threshold)} or more` +
    ` or above ${multiple}× the client's average (${ctx.baseCcy} ${fmt(average)}, ${basis}): ` +
    `${overThreshold.length} at or over the threshold, ${overMultiple.length} above ${multiple}× average; ` +
    `largest ${ctx.baseCcy} ${fmt(largest)} (${fmt(largest / (average || 1), 1)}× average); total ${ctx.baseCcy} ${fmt(sum(matched.map((t) => t.amount)))}.`;

  return {
    scenario: "large_amount",
    subtype: [overThreshold.length ? "over_threshold" : null, overMultiple.length ? "over_average_multiple" : null].filter(Boolean).join(","),
    summary,
    matchedTxnIds: matched.map((t) => t.id).sort((a, b) => a - b),
    metrics: {
      match_count: matched.length,
      over_threshold_count: overThreshold.length,
      over_multiple_count: overMultiple.length,
      average_amount: Math.round(average * 100) / 100,
      average_from_history: fromHistory ? 1 : 0,
      largest_amount: largest,
      total_amount: sum(matched.map((t) => t.amount)),
    },
    params: { large_amount_threshold: threshold, large_vs_avg_multiple: multiple },
  };
}
