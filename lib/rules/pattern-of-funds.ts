import type { RuleContext, RuleTxn, ScenarioFinding } from "./types";
import { addMonths, byDateThenId, daysBetween, dominantName, fmt, sum, uniqueSorted } from "./util";

const namePart = (key: string) => key.split("|")[0];

/** Linked party: same normalised name, or same account number (DECISIONS I2). */
function linked(a: RuleTxn, b: RuleTxn) {
  return namePart(a.cpKey) === namePart(b.cpKey) || (!!a.account && a.account === b.account);
}

/**
 * (a) Pass-through: each incoming credit, then outgoing debits within passthrough_days whose sum is
 * within passthrough_tolerance of it – first a single debit, else the date-ordered run whose
 * running total first lands within tolerance. Each debit is used once (DECISIONS I3).
 */
export function passThrough(ctx: RuleContext) {
  const { passthrough_days: days, passthrough_tolerance: tol } = ctx.params;
  const credits = ctx.period.filter((t) => t.direction === "incoming").sort(byDateThenId);
  const debits = ctx.period.filter((t) => t.direction === "outgoing").sort(byDateThenId);
  const used = new Set<number>();
  const pairs: { credit: RuleTxn; debits: RuleTxn[]; diffPct: number }[] = [];
  for (const c of credits) {
    const window = debits.filter((d) => !used.has(d.id) && daysBetween(c.date, d.date) >= 0 && daysBetween(c.date, d.date) <= days);
    const within = (x: number) => Math.abs(x - c.amount) <= tol * c.amount;
    let chosen: RuleTxn[] | null = null;
    const single = window.find((d) => within(d.amount));
    if (single) chosen = [single];
    else {
      let running = 0;
      for (let i = 0; i < window.length; i++) {
        running += window[i].amount;
        if (within(running)) {
          chosen = window.slice(0, i + 1);
          break;
        }
        if (running > c.amount * (1 + tol)) break;
      }
    }
    if (chosen) {
      chosen.forEach((d) => used.add(d.id));
      const out = sum(chosen.map((d) => d.amount));
      pairs.push({ credit: c, debits: chosen, diffPct: Math.abs(out - c.amount) / c.amount });
    }
  }
  return pairs;
}

/** (b) Many-to-one / one-to-many: ≥ funnel_min_counterparties distinct parties in a funnel_window_days window (DECISIONS I1). */
export function funnels(ctx: RuleContext) {
  const { funnel_min_counterparties: min, funnel_window_days: days } = ctx.params;
  const result: { direction: "incoming" | "outgoing"; txns: RuleTxn[]; parties: number }[] = [];
  for (const direction of ["incoming", "outgoing"] as const) {
    const list = ctx.period.filter((t) => t.direction === direction).sort(byDateThenId);
    const matched = new Map<number, RuleTxn>();
    let maxParties = 0;
    for (let i = 0; i < list.length; i++) {
      const w = list.filter((t, j) => j >= i && daysBetween(list[i].date, t.date) <= days - 1);
      const parties = new Set(w.map((t) => namePart(t.cpKey))).size;
      if (parties >= min) {
        w.forEach((t) => matched.set(t.id, t));
        maxParties = Math.max(maxParties, parties);
      }
    }
    if (matched.size) result.push({ direction, txns: [...matched.values()], parties: maxParties });
  }
  return result;
}

/** (c) Circular: money sent to a party returns from the same or a linked party within circular_days, within tolerance. */
export function circular(ctx: RuleContext) {
  const { circular_days: days, passthrough_tolerance: tol } = ctx.params;
  const outs = ctx.period.filter((t) => t.direction === "outgoing").sort(byDateThenId);
  const ins = ctx.period.filter((t) => t.direction === "incoming").sort(byDateThenId);
  const used = new Set<number>();
  const loops: { out: RuleTxn; back: RuleTxn }[] = [];
  for (const o of outs) {
    const back = ins.find(
      (i) =>
        !used.has(i.id) &&
        linked(o, i) &&
        daysBetween(o.date, i.date) > 0 &&
        daysBetween(o.date, i.date) <= days &&
        Math.abs(i.amount - o.amount) <= tol * o.amount,
    );
    if (back) {
      used.add(back.id);
      loops.push({ out: o, back });
    }
  }
  return loops;
}

/** (d) Volume change: period monthly value vs prior 6-month average and/or KYC expected monthly value (DECISIONS I4). */
export function volumeChange(ctx: RuleContext) {
  const months = (daysBetween(ctx.periodStart, ctx.periodEnd) + 1) / (365.25 / 12);
  const periodMonthly = months > 0 ? sum(ctx.period.map((t) => t.amount)) / months : 0;
  const priorFrom = addMonths(ctx.periodStart, -6);
  const prior = ctx.history.filter((t) => t.date >= priorFrom && t.date < ctx.periodStart);
  const priorMonthly = prior.length ? sum(prior.map((t) => t.amount)) / 6 : null;
  const vsPrior = priorMonthly ? periodMonthly / priorMonthly : null;
  const vsKyc = ctx.kycExpectedMonthlyValue ? periodMonthly / ctx.kycExpectedMonthlyValue : null;
  const m = ctx.params.volume_change_multiple;
  return {
    periodMonthly,
    priorMonthly,
    vsPrior,
    vsKyc,
    fired: (vsPrior != null && vsPrior >= m) || (vsKyc != null && vsKyc >= m),
  };
}

export function patternOfFunds(ctx: RuleContext): ScenarioFinding | null {
  const p = ctx.params;
  const pairs = passThrough(ctx);
  const fun = funnels(ctx);
  const loops = circular(ctx);
  const vol = volumeChange(ctx);

  const matched = new Set<number>();
  const parts: string[] = [];
  const subtypes: string[] = [];

  if (pairs.length) {
    subtypes.push("pass_through");
    const ins = pairs.map((x) => x.credit);
    const outs = pairs.flatMap((x) => x.debits);
    [...ins, ...outs].forEach((t) => matched.add(t.id));
    const from = dominantName(ins);
    const to = dominantName(outs);
    const maxDiff = Math.max(...pairs.map((x) => x.diffPct));
    parts.push(
      `${pairs.length} pass-through pair${pairs.length === 1 ? "" : "s"}: in${from ? ` from ${from}` : ""}, out${to ? ` to ${to}` : ""}` +
        ` within ≤ ${p.passthrough_days} days, amounts within ${Math.max(1, Math.ceil(maxDiff * 100))}%.`,
    );
  }
  for (const f of fun) {
    subtypes.push(f.direction === "incoming" ? "many_to_one" : "one_to_many");
    f.txns.forEach((t) => matched.add(t.id));
    parts.push(
      f.direction === "incoming"
        ? `Funds from up to ${f.parties} different counterparties within ${p.funnel_window_days} days (${f.txns.length} txns).`
        : `Funds to up to ${f.parties} different counterparties within ${p.funnel_window_days} days (${f.txns.length} txns).`,
    );
  }
  if (loops.length) {
    subtypes.push("circular");
    loops.forEach((l) => {
      matched.add(l.out.id);
      matched.add(l.back.id);
    });
    parts.push(`${loops.length} circular movement${loops.length === 1 ? "" : "s"}: funds sent and returned from the same or a linked party within ${p.circular_days} days.`);
  }
  if (vol.fired) {
    subtypes.push("volume_change");
    const bits: string[] = [];
    if (vol.vsPrior != null && vol.vsPrior >= p.volume_change_multiple) bits.push(`${fmt(vol.vsPrior, 1)}× versus prior 6-month average`);
    if (vol.vsKyc != null && vol.vsKyc >= p.volume_change_multiple) bits.push(`${fmt(vol.vsKyc, 1)}× KYC expected monthly value`);
    parts.push(`Monthly volume up ${bits.join(" and ")}.`);
  }
  if (!subtypes.length) return null;

  return {
    scenario: "pattern_of_funds",
    subtype: subtypes.join(","),
    summary: parts.join(" "),
    matchedTxnIds: uniqueSorted(matched),
    metrics: {
      match_count: matched.size,
      pass_through_pairs: pairs.length,
      funnel_in_txns: fun.find((f) => f.direction === "incoming")?.txns.length ?? 0,
      funnel_out_txns: fun.find((f) => f.direction === "outgoing")?.txns.length ?? 0,
      circular_count: loops.length,
      period_monthly_value: Math.round(vol.periodMonthly),
      ...(vol.priorMonthly != null ? { prior_6m_monthly_value: Math.round(vol.priorMonthly) } : {}),
      ...(vol.vsPrior != null ? { volume_vs_prior: Math.round(vol.vsPrior * 100) / 100 } : {}),
      ...(vol.vsKyc != null ? { volume_vs_kyc: Math.round(vol.vsKyc * 100) / 100 } : {}),
    },
    params: {
      passthrough_days: p.passthrough_days,
      passthrough_tolerance: p.passthrough_tolerance,
      funnel_min_counterparties: p.funnel_min_counterparties,
      funnel_window_days: p.funnel_window_days,
      circular_days: p.circular_days,
      volume_change_multiple: p.volume_change_multiple,
    },
  };
}
