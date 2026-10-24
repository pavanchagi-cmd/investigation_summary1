/* Dev helper: runs the rules and ranking on a seed alert's ground truth and prints the results. */
import { buildSeedAlerts } from "../lib/seed/alerts";
import { DEFAULT_CONFIG } from "../lib/config/schema";
import { runRules, type RuleTxn } from "../lib/rules";
import { passThrough, funnels, circular, volumeChange } from "../lib/rules/pattern-of-funds";
import { counterpartyKey } from "../lib/ranking/keys";

const only = process.argv[2];
for (const a of buildSeedAlerts()) {
  if (only && a.alertNumber !== only) continue;
  const toRule = (t: (typeof a.txns)[number], id: number): RuleTxn => ({
    id, date: t.date, direction: t.direction, amount: t.amount, type: t.type,
    cpKey: counterpartyKey(t.cp.name, t.cp.account, DEFAULT_CONFIG.legal_suffixes), cpName: t.cp.name, account: t.cp.account,
  });
  const all = a.txns.map(toRule.bind(null) as never as (t: (typeof a.txns)[number], i: number) => RuleTxn);
  const period = all.filter((t) => t.date >= a.reviewStart && t.date <= a.reviewEnd);
  const history = all.filter((t) => !(t.date >= a.reviewStart && t.date <= a.reviewEnd));
  const ctx = { period, history, periodStart: a.reviewStart, periodEnd: a.reviewEnd, kycExpectedMonthlyValue: a.client.expected.monthlyValue, params: DEFAULT_CONFIG.rules, baseCcy: "USD" };
  console.log(`\n== ${a.alertNumber}: in-period ${period.length}, history ${history.length}, flow ${period.reduce((s, t) => s + t.amount, 0).toFixed(2)}`);
  console.log(`   outgoing ${period.filter((t) => t.direction === "outgoing").length}`);
  for (const f of runRules(ctx)) console.log(`   ${f.scenario} [${f.subtype}] ${f.matchedTxnIds.length}: ${f.summary}`);
  const pt = passThrough(ctx);
  console.log(`   pass-through pairs: ${pt.map((p) => `${p.credit.date} ${p.credit.cpName} ${p.credit.amount} -> ${p.debits.map((d) => `${d.date} ${d.cpName} ${d.amount}`).join("+")}`).join("\n      ")}`);
  console.log(`   funnels: ${JSON.stringify(funnels(ctx).map((f) => [f.direction, f.parties, f.txns.length]))}`);
  console.log(`   circular: ${circular(ctx).map((c) => `${c.out.cpName} ${c.out.amount} -> ${c.back.amount}`).join("; ")}`);
  console.log(`   volume: ${JSON.stringify(volumeChange(ctx))}`);
}
