/** Header synonym dictionary for transaction files (spec section 5, "Column mapping"). */

export const TXN_FIELDS = [
  "date",
  "transaction_id",
  "direction",
  "debit",
  "credit",
  "amount",
  "currency",
  "type",
  "counterparty_name",
  "counterparty_account",
  "counterparty_bank",
  "counterparty_bank_country",
  "originator_country",
  "beneficiary_country",
  "reference_text",
] as const;
export type TxnField = (typeof TXN_FIELDS)[number];

export const TXN_FIELD_LABELS: Record<TxnField, string> = {
  date: "Date",
  transaction_id: "Transaction ID",
  direction: "Direction (in/out)",
  debit: "Debit amount",
  credit: "Credit amount",
  amount: "Amount",
  currency: "Currency",
  type: "Transaction type",
  counterparty_name: "Counterparty name",
  counterparty_account: "Counterparty account",
  counterparty_bank: "Counterparty bank",
  counterparty_bank_country: "Counterparty bank country",
  originator_country: "Originator country",
  beneficiary_country: "Beneficiary country",
  reference_text: "Reference / purpose",
};

const SYNONYMS: Record<TxnField, string[]> = {
  date: ["date", "txn date", "transaction date", "value date", "posting date", "booking date", "trade date", "date of transaction"],
  transaction_id: ["transaction id", "txn id", "transaction ref", "transaction reference", "txn ref", "reference number", "ref no", "trn", "id", "utr"],
  direction: ["direction", "dr cr", "cr dr", "debit credit", "credit debit", "in out", "flow", "debit credit indicator", "dc"],
  debit: ["debit", "debit amount", "dr amount", "withdrawal", "withdrawals", "paid out", "outflow"],
  credit: ["credit", "credit amount", "cr amount", "deposit", "deposits", "paid in", "inflow"],
  amount: ["amount", "txn amount", "transaction amount", "value", "amt", "amount ccy", "original amount"],
  currency: ["currency", "ccy", "curr", "currency code", "txn currency"],
  type: ["type", "txn type", "transaction type", "channel", "method", "payment type", "instrument"],
  counterparty_name: ["counterparty", "counterparty name", "beneficiary remitter", "party name", "beneficiary name", "remitter name", "other party", "payee payer", "cp name"],
  counterparty_account: ["counterparty account", "counterparty account number", "beneficiary account", "remitter account", "account number", "cp account", "iban"],
  counterparty_bank: ["counterparty bank", "beneficiary bank", "remitter bank", "bank", "bank name", "cp bank"],
  counterparty_bank_country: ["counterparty bank country", "bank country", "beneficiary bank country", "remitter bank country", "cp bank country"],
  originator_country: ["originator country", "ordering country", "remitter country", "sender country", "origin country"],
  beneficiary_country: ["beneficiary country", "receiver country", "destination country", "payee country"],
  reference_text: ["reference", "narrative", "description", "purpose", "remarks", "details", "payment reference", "payment details", "reference text", "memo"],
};

export function normaliseHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export type HeaderMapping = Partial<Record<TxnField, number>>;

export type MappingResult = {
  mapping: HeaderMapping;
  /** Required fields that could not be mapped (the UI then shows the mapping dialog). */
  missing: ("date" | "amount" | "direction")[];
  unmapped: string[];
};

/**
 * Maps file headers to normalised fields. `overrides` (field → header text) come from the
 * analyst's mapping dialog and win over synonyms.
 */
export function mapHeaders(headers: string[], overrides?: Record<string, string> | null): MappingResult {
  const norm = headers.map(normaliseHeader);
  const mapping: HeaderMapping = {};
  const used = new Set<number>();

  if (overrides) {
    for (const [field, header] of Object.entries(overrides)) {
      if (!(TXN_FIELDS as readonly string[]).includes(field) || !header) continue;
      const idx = headers.findIndex((h) => h === header);
      if (idx >= 0) {
        mapping[field as TxnField] = idx;
        used.add(idx);
      }
    }
  }

  // Exact synonym matches first (most specific fields first so "bank country" beats "bank").
  const order = [...TXN_FIELDS].sort((a, b) => longestSynonym(b) - longestSynonym(a));
  for (const field of order) {
    if (mapping[field] != null) continue;
    const idx = norm.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(h));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }

  const missing: MappingResult["missing"] = [];
  if (mapping.date == null) missing.push("date");
  const hasDebitCredit = mapping.debit != null && mapping.credit != null;
  if (mapping.amount == null && !hasDebitCredit) missing.push("amount");
  if (mapping.direction == null && !hasDebitCredit) missing.push("direction");

  const unmapped = headers.filter((_, i) => !used.has(i) && norm[i] !== "");
  return { mapping, missing, unmapped };
}

function longestSynonym(f: TxnField) {
  return Math.max(...SYNONYMS[f].map((s) => s.length));
}
