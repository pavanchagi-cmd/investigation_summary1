import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { mapHeaders, normaliseHeader } from "@/lib/parsing/headers";
import {
  detectDayMonthOrder,
  parseAmount,
  parseCountry,
  parseCurrency,
  parseDateValue,
  parseDirection,
  parseTxnType,
} from "@/lib/parsing/values";
import { DIRECTION_FROM_SIGN, normaliseTransactions, type RawRow } from "@/lib/parsing/normalise";
import { detectDocType } from "@/lib/parsing/detect";
import { readCsv, readWorkbook, currencyFromPreamble } from "@/lib/parsing/spreadsheet";
import { parseCounterpartyDetails } from "@/lib/parsing/counterparty-details";

const fx = { base: "USD", rates: { USD: 1, INR: 0.012, EUR: 1.08 } };

describe("header mapping", () => {
  it("normalises headers", () => {
    expect(normaliseHeader("  Txn Date (DD/MM) ")).toBe("txn date");
    expect(normaliseHeader("Counterparty_Bank_Country")).toBe("counterparty bank country");
  });

  it("maps synonyms and reports missing required columns", () => {
    const r = mapHeaders(["Value Date", "Txn Ref", "Debit", "Credit", "CCY", "Beneficiary/Remitter", "Narrative"]);
    expect(r.mapping.date).toBe(0);
    expect(r.mapping.transaction_id).toBe(1);
    expect(r.mapping.debit).toBe(2);
    expect(r.mapping.credit).toBe(3);
    expect(r.mapping.currency).toBe(4);
    expect(r.mapping.counterparty_name).toBe(5);
    expect(r.mapping.reference_text).toBe(6);
    expect(r.missing).toEqual([]);
  });

  it("asks for a mapping when amount or direction cannot be found", () => {
    const r = mapHeaders(["When", "How much", "Who"]);
    expect(r.missing).toEqual(["date", "amount", "direction"]);
  });

  it("prefers the specific bank-country column over bank", () => {
    const r = mapHeaders(["Date", "Amount", "Direction", "Bank", "Bank Country"]);
    expect(r.mapping.counterparty_bank).toBe(3);
    expect(r.mapping.counterparty_bank_country).toBe(4);
  });

  it("applies analyst overrides", () => {
    const r = mapHeaders(["When", "How much", "Who"], { date: "When", amount: "How much", direction: DIRECTION_FROM_SIGN });
    expect(r.mapping.date).toBe(0);
    expect(r.mapping.amount).toBe(1);
  });
});

describe("dates", () => {
  it("parses ISO, DD-Mon-YY and DD Mon YYYY", () => {
    expect(parseDateValue("2026-07-03")).toEqual({ ok: true, value: "2026-07-03" });
    expect(parseDateValue("03-Jul-26")).toEqual({ ok: true, value: "2026-07-03" });
    expect(parseDateValue("3 Sep 2026")).toEqual({ ok: true, value: "2026-09-03" });
  });

  it("treats ambiguous day/month as an issue, not a guess", () => {
    const r = parseDateValue("03/07/2026");
    expect(r.ok).toBe(false);
  });

  it("uses the column's proven order", () => {
    expect(detectDayMonthOrder(["03/07/2026", "25/07/2026"])).toBe("dmy");
    expect(parseDateValue("03/07/2026", "dmy")).toEqual({ ok: true, value: "2026-07-03" });
    expect(detectDayMonthOrder(["07/25/2026"])).toBe("mdy");
    expect(detectDayMonthOrder(["25/07/2026", "07/25/2026"])).toBe("conflict");
    expect(parseDateValue("03/07/2026", "conflict").ok).toBe(false);
  });

  it("unambiguous slash dates parse without a column hint", () => {
    expect(parseDateValue("25/07/2026")).toEqual({ ok: true, value: "2026-07-25" });
  });

  it("converts Excel serials and rejects impossible dates", () => {
    expect(parseDateValue(46206)).toEqual({ ok: true, value: "2026-07-03" });
    expect(parseDateValue("31/02/2026", "dmy").ok).toBe(false);
    expect(parseDateValue(4900).ok).toBe(false);
    expect(parseDateValue("").ok).toBe(false);
    expect(parseDateValue("next Tuesday").ok).toBe(false);
  });
});

describe("amounts", () => {
  it("strips separators and currency codes", () => {
    expect(parseAmount("1,284,000.00")).toEqual({ ok: true, value: 1284000 });
    expect(parseAmount("USD 9,950.00")).toEqual({ ok: true, value: 9950 });
    expect(parseAmount("(2,500.50)")).toEqual({ ok: true, value: -2500.5 });
    expect(parseAmount(-120)).toEqual({ ok: true, value: -120 });
  });

  it("flags letters inside numbers", () => {
    const r = parseAmount("4,9OO.00");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain("letters");
  });

  it("rejects malformed numbers", () => {
    expect(parseAmount("1.2.3").ok).toBe(false);
    expect(parseAmount("").ok).toBe(false);
  });
});

describe("other value parsers", () => {
  it("direction words", () => {
    expect(parseDirection("CR")).toEqual({ ok: true, value: "incoming" });
    expect(parseDirection("Debit")).toEqual({ ok: true, value: "outgoing" });
    expect(parseDirection("sideways").ok).toBe(false);
  });
  it("type synonyms map to the six types", () => {
    expect(parseTxnType("SWIFT")).toEqual({ ok: true, value: "wire" });
    expect(parseTxnType("TT")).toEqual({ ok: true, value: "wire" });
    expect(parseTxnType("NEFT")).toEqual({ ok: true, value: "ach" });
    expect(parseTxnType("")).toEqual({ ok: true, value: null });
    expect(parseTxnType("barter").ok).toBe(false);
  });
  it("currency and country codes", () => {
    expect(parseCurrency("usd")).toEqual({ ok: true, value: "USD" });
    expect(parseCurrency("XYZ").ok).toBe(false);
    expect(parseCountry("India")).toEqual({ ok: true, value: "IN" });
    expect(parseCountry("XA")).toEqual({ ok: true, value: "XA" });
    expect(parseCountry("ZZ").ok).toBe(false);
    expect(parseCountry("")).toEqual({ ok: true, value: null });
  });
});

describe("normaliser", () => {
  const headers = ["Date", "Txn ID", "Direction", "Amount", "Currency", "Type", "Counterparty", "Bank Country", "Reference"];
  const row = (n: number, cells: unknown[]): RawRow => ({
    sourceRow: `row ${n}`,
    cells: Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? null])),
  });

  it("normalises good rows and turns bad rows into issues – nothing dropped", () => {
    const rows = [
      row(2, ["2026-07-03", "TX-1", "in", "92,000.00", "USD", "SWIFT", "Harbourline Logistics FZE", "AE", "INV-1"]),
      row(3, ["2026-07-04", "", "out", "4,9OO.00", "USD", "wire", "Morrow Metals Ltd", "HK", ""]),
      row(4, ["", "TX-3", "out", "1,000", "USD", "wire", "Pinewood", "IN", ""]),
      row(5, ["2026-07-05", "", "out", "2,500", "INR", "neft", "Pinewood", "IN", ""]),
    ];
    const r = normaliseTransactions(headers, rows, { documentId: 9, fx });
    expect(r.missingColumns).toEqual([]);
    expect(r.txns).toHaveLength(2);
    expect(r.txns[0]).toMatchObject({ direction: "incoming", amount: 92000, amountBaseCcy: 92000, type: "wire", counterpartyBankCountry: "AE" });
    expect(r.txns[1]).toMatchObject({ transactionId: "GEN-9-5", idGenerated: true, currency: "INR", amountBaseCcy: 30 });
    expect(r.issues.map((i) => i.sourceRowOrPage)).toEqual(["row 3", "row 4"]);
    expect(r.issues[0].rawValue).toBe("4,9OO.00");
    expect(r.issues[1].problem).toContain("missing date");
    expect(r.txns.length + new Set(r.issues.map((i) => i.sourceRowOrPage)).size).toBe(rows.length);
  });

  it("derives direction from debit/credit columns", () => {
    const h = ["Date", "Debit", "Credit", "Currency"];
    const rows: RawRow[] = [
      { sourceRow: "row 2", cells: { Date: "2026-07-01", Debit: "500", Credit: null, Currency: "USD" } },
      { sourceRow: "row 3", cells: { Date: "2026-07-01", Debit: null, Credit: "700", Currency: "USD" } },
      { sourceRow: "row 4", cells: { Date: "2026-07-01", Debit: "5", Credit: "7", Currency: "USD" } },
    ];
    const r = normaliseTransactions(h, rows, { documentId: 1, fx });
    expect(r.txns.map((t) => [t.direction, t.amount])).toEqual([
      ["outgoing", 500],
      ["incoming", 700],
    ]);
    expect(r.issues[0].problem).toContain("both debit and credit");
  });

  it("uses the amount sign only when the analyst chose it", () => {
    const h = ["Date", "Amount", "Currency"];
    const rows: RawRow[] = [{ sourceRow: "row 2", cells: { Date: "2026-07-01", Amount: "-250", Currency: "USD" } }];
    expect(normaliseTransactions(h, rows, { documentId: 1, fx }).missingColumns).toEqual(["direction"]);
    const r = normaliseTransactions(h, rows, { documentId: 1, fx, overrides: { direction: DIRECTION_FROM_SIGN } });
    expect(r.txns[0]).toMatchObject({ direction: "outgoing", amount: 250 });
  });

  it("requires a stated currency and a rate", () => {
    const h = ["Date", "Amount", "Direction"];
    const rows: RawRow[] = [{ sourceRow: "row 2", cells: { Date: "2026-07-01", Amount: "250", Direction: "in" } }];
    expect(normaliseTransactions(h, rows, { documentId: 1, fx }).issues[0].problem).toContain("not stated");
    expect(normaliseTransactions(h, rows, { documentId: 1, fx, documentCurrency: "USD" }).txns).toHaveLength(1);
    expect(normaliseTransactions(h, rows, { documentId: 1, fx, documentCurrency: "GBP" }).issues[0].problem).toContain("rate");
  });

  it("re-validates with analyst fixes", () => {
    const rows = [row(3, ["2026-07-04", "TX-2", "out", "4,9OO.00", "USD", "wire", "Morrow", "HK", ""])];
    const fixes = new Map([["row 3|amount", "4,900.00"]]);
    const r = normaliseTransactions(headers, rows, { documentId: 1, fx, fixes });
    expect(r.issues).toHaveLength(0);
    expect(r.txns[0].amount).toBe(4900);
  });
});

describe("spreadsheet reading", () => {
  it("finds the header row below a title and keeps Excel row numbers", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Account statement – account currency: USD"],
      [],
      ["Date", "Txn ID", "Direction", "Amount"],
      ["2026-07-01", "TX-1", "in", 100],
      [],
      ["2026-07-02", "TX-2", "out", 50],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const sheet = readWorkbook(buf);
    expect(sheet.headers).toEqual(["Date", "Txn ID", "Direction", "Amount"]);
    expect(sheet.rows.map((r) => r.sourceRow)).toEqual(["row 4", "row 6"]);
    expect(currencyFromPreamble(sheet.preamble)).toBe("USD");
  });

  it("reads CSV with a BOM", () => {
    const sheet = readCsv(Buffer.from("﻿Name,Account,Bank,Bank Country\nHarbourline Logistics FZE,AE070331234567892210,Gulf Mercantile Bank,AE\n,123,X,IN\n"));
    const parsed = parseCounterpartyDetails(sheet);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ name: "Harbourline Logistics FZE", bank_country: "AE", row: 2 });
    expect(parsed.issues[0]).toMatchObject({ sourceRowOrPage: "row 3", problem: "Counterparty name is missing" });
  });
});

describe("document type detection", () => {
  it("uses file-name keywords first", () => {
    expect(detectDocType("alert_report_ALR-2026-000123.pdf")).toBe("alert_report");
    expect(detectDocType("transactions_Q3.xlsx")).toBe("transaction_list");
    expect(detectDocType("kyc_profile_CIF10048832.pdf")).toBe("kyc_profile");
    expect(detectDocType("counterparties.csv")).toBe("counterparty_details");
    expect(detectDocType("prior_cases.docx")).toBe("case_history");
    expect(detectDocType("rfi_response_scan.jpg")).toBe("rfi_response");
  });
  it("falls back to sheet headers, then null", () => {
    expect(detectDocType("export.xlsx", ["Value Date", "Amount", "Narrative"])).toBe("transaction_list");
    expect(detectDocType("list.csv", ["Name", "Bank", "Account Number"])).toBe("counterparty_details");
    expect(detectDocType("scan001.pdf")).toBeNull();
  });
});
