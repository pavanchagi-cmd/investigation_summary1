import type { RuleParams } from "@/lib/config/schema";

export type ScenarioKey = "large_amount" | "pattern_of_funds" | "round_dollar" | "wire_structuring";

/** One in-scope transaction as the rules see it (amounts in base currency). */
export type RuleTxn = {
  id: number;
  date: string; // YYYY-MM-DD
  direction: "incoming" | "outgoing";
  amount: number;
  type: "wire" | "ach" | "cash" | "cheque" | "card" | "internal" | null;
  /** Normalised counterparty key (see lib/ranking/keys.ts). */
  cpKey: string;
  cpName: string;
  account: string | null;
};

export type RuleContext = {
  /** In-period transactions. */
  period: RuleTxn[];
  /** Transactions outside the review period (history), if any. */
  history: RuleTxn[];
  periodStart: string;
  periodEnd: string;
  kycExpectedMonthlyValue: number | null;
  params: RuleParams;
  baseCcy: string;
};

export type ScenarioFinding = {
  scenario: ScenarioKey;
  subtype?: string; // e.g. 'pass_through', 'split_payments'
  summary: string; // one line, plain English, includes the numbers
  matchedTxnIds: number[];
  metrics: Record<string, number>;
  params: Record<string, number>; // the config values used
};
