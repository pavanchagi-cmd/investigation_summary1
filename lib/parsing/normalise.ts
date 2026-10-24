import { mapHeaders, type HeaderMapping, type TxnField, TXN_FIELD_LABELS } from "./headers";
import {
  cleanText,
  detectDayMonthOrder,
  parseAmount,
  parseCountry,
  parseCurrency,
  parseDateValue,
  parseDirection,
  parseTxnType,
  type DayMonthOrder,
  type TxnType,
} from "./values";

/** Special mapping value: derive direction from the sign of the amount column. */
export const DIRECTION_FROM_SIGN = "__sign__";

export type RawRow = { sourceRow: string; cells: Record<string, unknown> };

export type NormalisedTxn = {
  sourceRow: string;
  date: string;
  transactionId: string;
  idGenerated: boolean;
  direction: "incoming" | "outgoing";
  amount: number;
  currency: string;
  amountBaseCcy: number;
  type: TxnType | null;
  counterpartyName: string | null;
  counterpartyAccount: string | null;
  counterpartyBank: string | null;
  counterpartyBankCountry: string | null;
  originatorCountry: string | null;
  beneficiaryCountry: string | null;
  referenceText: string | null;
};

export type RowIssue = {
  sourceRowOrPage: string;
  field: string | null;
  rawValue: string | null;
  problem: string;
  rawRow: Record<string, unknown> | null;
};

export type NormaliseOptions = {
  documentId: number;
  /** Currency stated at document level (file header or analyst-confirmed). */
  documentCurrency?: string | null;
  fx: { base: string; rates: Record<string, number> };
  /** Analyst mapping overrides (field → header). */
  overrides?: Record<string, string> | null;
  /** Corrected values from earlier "Fix" actions, keyed by `${sourceRow}|${field}`. */
  fixes?: Map<string, string>;
};

export type NormaliseResult = {
  txns: NormalisedTxn[];
  issues: RowIssue[];
  /** Required columns that could not be mapped; when non-empty no rows are parsed. */
  missingColumns: string[];
  mapping: HeaderMapping;
  headers: string[];
};

/** Turns header-indexed rows into normalised transactions; every failing row becomes an issue. */
export function normaliseTransactions(headers: string[], rows: RawRow[], opts: NormaliseOptions): NormaliseResult {
  const { mapping, missing } = mapHeaders(headers, opts.overrides);
  const signDirection = opts.overrides?.direction === DIRECTION_FROM_SIGN;
  const missingColumns = missing.filter((m) => !(m === "direction" && signDirection));
  if (missingColumns.length) return { txns: [], issues: [], missingColumns, mapping, headers };

  const col = (f: TxnField) => (mapping[f] != null ? headers[mapping[f]!] : undefined);
  const dateOrder: DayMonthOrder = detectDayMonthOrder(rows.map((r) => r.cells[col("date")!]));
  const txns: NormalisedTxn[] = [];
  const issues: RowIssue[] = [];

  for (const row of rows) {
    const get = (f: TxnField): unknown => {
      const fixKey = `${row.sourceRow}|${f}`;
      if (opts.fixes?.has(fixKey)) return opts.fixes.get(fixKey);
      const h = col(f);
      return h === undefined ? undefined : row.cells[h];
    };
    const problems: RowIssue[] = [];
    const issue = (field: TxnField | "row", raw: unknown, problem: string) =>
      problems.push({
        sourceRowOrPage: row.sourceRow,
        field,
        rawValue: raw == null ? null : String(raw),
        problem: field === "row" ? problem : `${TXN_FIELD_LABELS[field as TxnField]}: ${problem}`,
        rawRow: row.cells,
      });

    const date = parseDateValue(get("date"), dateOrder);
    if (!date.ok) issue("date", get("date"), date.problem);

    // Amount and direction: direction column, or debit/credit columns, or the amount's sign.
    let amount: number | null = null;
    let direction: "incoming" | "outgoing" | null = null;
    if (mapping.amount != null) {
      const a = parseAmount(get("amount"));
      if (!a.ok) issue("amount", get("amount"), a.problem);
      else if (a.value === 0) issue("amount", get("amount"), "amount is zero");
      else {
        if (mapping.direction != null) {
          const d = parseDirection(get("direction"));
          if (!d.ok) issue("direction", get("direction"), d.problem);
          else if (a.value < 0) issue("amount", get("amount"), "negative amount alongside a direction column");
          else {
            direction = d.value;
            amount = a.value;
          }
        } else if (signDirection) {
          direction = a.value < 0 ? "outgoing" : "incoming";
          amount = Math.abs(a.value);
        } else if (mapping.debit != null && mapping.credit != null) {
          const fromDc = debitCredit(get("debit"), get("credit"));
          if (!fromDc.ok) issue("row", null, fromDc.problem);
          else {
            direction = fromDc.direction;
            amount = Math.abs(a.value);
          }
        }
      }
    } else {
      const fromDc = debitCredit(get("debit"), get("credit"));
      if (!fromDc.ok) issue("row", `${get("debit") ?? ""} / ${get("credit") ?? ""}`, fromDc.problem);
      else {
        direction = fromDc.direction;
        amount = fromDc.amount;
      }
    }

    let currency: string | null = null;
    if (mapping.currency != null && cleanText(get("currency"))) {
      const c = parseCurrency(get("currency"));
      if (!c.ok) issue("currency", get("currency"), c.problem);
      else currency = c.value;
    } else if (opts.documentCurrency) {
      currency = opts.documentCurrency;
    } else {
      issue("currency", null, "not stated in the row or the file");
    }

    let amountBase: number | null = null;
    if (currency && amount != null) {
      const rate = opts.fx.rates[currency];
      if (rate == null) issue("currency", currency, `no ${currency}→${opts.fx.base} rate in the rate table`);
      else amountBase = Math.round(amount * rate * 100) / 100;
    }

    const type = parseTxnType(get("type"));
    if (!type.ok) issue("type", get("type"), type.problem);

    const countries = {
      counterparty_bank_country: parseCountry(get("counterparty_bank_country")),
      originator_country: parseCountry(get("originator_country")),
      beneficiary_country: parseCountry(get("beneficiary_country")),
    };
    for (const [f, r] of Object.entries(countries)) if (!r.ok) issue(f as TxnField, get(f as TxnField), r.problem);

    if (problems.length) {
      issues.push(...problems);
      continue;
    }

    const rawId = cleanText(get("transaction_id"));
    const rowNum = row.sourceRow.replace(/[^0-9]/g, "") || row.sourceRow;
    txns.push({
      sourceRow: row.sourceRow,
      date: (date as { value: string }).value,
      transactionId: rawId ?? `GEN-${opts.documentId}-${rowNum}`,
      idGenerated: !rawId,
      direction: direction!,
      amount: amount!,
      currency: currency!,
      amountBaseCcy: amountBase!,
      type: (type as { value: TxnType | null }).value,
      counterpartyName: cleanText(get("counterparty_name")),
      counterpartyAccount: cleanText(get("counterparty_account")),
      counterpartyBank: cleanText(get("counterparty_bank")),
      counterpartyBankCountry: (countries.counterparty_bank_country as { value: string | null }).value,
      originatorCountry: (countries.originator_country as { value: string | null }).value,
      beneficiaryCountry: (countries.beneficiary_country as { value: string | null }).value,
      referenceText: cleanText(get("reference_text")),
    });
  }
  return { txns, issues, missingColumns: [], mapping, headers };
}

function debitCredit(
  debitRaw: unknown,
  creditRaw: unknown,
): { ok: true; direction: "incoming" | "outgoing"; amount: number } | { ok: false; problem: string } {
  const hasD = cleanText(debitRaw) != null;
  const hasC = cleanText(creditRaw) != null;
  if (hasD && hasC) {
    const d = parseAmount(debitRaw);
    const c = parseAmount(creditRaw);
    // A zero in one column is common ("0.00"): treat it as empty.
    if (d.ok && d.value === 0 && c.ok && c.value !== 0) return { ok: true, direction: "incoming", amount: Math.abs(c.value) };
    if (c.ok && c.value === 0 && d.ok && d.value !== 0) return { ok: true, direction: "outgoing", amount: Math.abs(d.value) };
    return { ok: false, problem: "both debit and credit are filled" };
  }
  if (!hasD && !hasC) return { ok: false, problem: "neither debit nor credit is filled" };
  const a = parseAmount(hasD ? debitRaw : creditRaw);
  if (!a.ok) return { ok: false, problem: `${hasD ? "Debit" : "Credit"}: ${a.problem}` };
  if (a.value === 0) return { ok: false, problem: "amount is zero" };
  return { ok: true, direction: hasD ? "outgoing" : "incoming", amount: Math.abs(a.value) };
}
