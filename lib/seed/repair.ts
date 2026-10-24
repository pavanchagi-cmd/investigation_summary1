import { DEFAULT_CONFIG } from "@/lib/config/schema";
import { passThrough } from "@/lib/rules/pattern-of-funds";
import type { RuleTxn } from "@/lib/rules/types";
import { counterpartyKey } from "@/lib/ranking/keys";
import { isoDay } from "./random";
import type { SeedTxn } from "./types";

type Planned = Omit<SeedTxn, "txnId">;

function toRule(list: Planned[]): RuleTxn[] {
  return list.map((t, i) => ({
    id: i,
    date: t.date,
    direction: t.direction,
    amount: t.amount,
    type: t.type,
    cpKey: counterpartyKey(t.cp.name, t.cp.account, DEFAULT_CONFIG.legal_suffixes),
    cpName: t.cp.name,
    account: t.cp.account,
  }));
}

/**
 * Seed-construction helper: while a receipt that is not a planted pass-through credit pairs with
 * payments, move it one day later (wrapping inside the period). Deterministic.
 */
export function repairPassThrough(txns: Planned[], start: string, lastDay: number, planted: (credit: Planned) => boolean) {
  const dayOf = (iso: string) => Math.round((Date.parse(iso) - Date.parse(start)) / 86_400_000);
  for (let guard = 0; guard < 500; guard++) {
    const rules = toRule(txns);
    const pairs = passThrough({
      period: rules,
      history: [],
      periodStart: start,
      periodEnd: isoDay(start, lastDay),
      kycExpectedMonthlyValue: null,
      params: DEFAULT_CONFIG.rules,
      baseCcy: "USD",
    });
    const bad = pairs.find((p) => !planted(txns[p.credit.id]));
    if (!bad) return;
    const t = txns[bad.credit.id];
    t.date = isoDay(start, (dayOf(t.date) + 1) % (lastDay + 1));
  }
  throw new Error("Seed repair did not converge");
}
