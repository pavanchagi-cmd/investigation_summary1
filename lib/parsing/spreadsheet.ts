import * as XLSX from "@e965/xlsx";
import Papa from "papaparse";
import { normaliseHeader, TXN_FIELDS } from "./headers";
import type { RawRow } from "./normalise";

export type Sheet = {
  headers: string[];
  rows: RawRow[];
  /** Text above the header row (titles such as "Account currency: USD"). */
  preamble: string[];
  /** Spreadsheet row number of the header row (1-based). */
  headerRowNumber: number;
};

const KNOWN = new Set<string>([
  "date", "amount", "debit", "credit", "currency", "ccy", "direction", "type", "reference", "narrative",
  "description", "counterparty", "counterparty name", "beneficiary name", "transaction id", "txn id", "value date",
  "name", "bank", "account", "account number", "country", "bank country", ...TXN_FIELDS.map((f) => f.replace(/_/g, " ")),
]);

/** Reads the first worksheet (XLSX/XLS) into raw cell values keyed by header text. */
export function readWorkbook(buf: Buffer): Sheet {
  // Dates stay as Excel serial numbers (timezone-free); the date parser converts them.
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, dense: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { headers: [], rows: [], preamble: [], headerRowNumber: 0 };
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  // sheet_to_json with header:1 starts at the sheet's first used row; account for its offset.
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  return fromMatrix(matrix, range.s.r + 1);
}

export function readCsv(buf: Buffer): Sheet {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const res = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return fromMatrix(res.data as unknown[][], 1);
}

function fromMatrix(matrix: unknown[][], firstRowNumber: number): Sheet {
  const headerIdx = findHeaderRow(matrix);
  if (headerIdx < 0) return { headers: [], rows: [], preamble: [], headerRowNumber: 0 };
  const rawHeaders = (matrix[headerIdx] ?? []).map((h) => (h == null ? "" : String(h).trim()));
  // Make duplicate/blank headers unique so no column is lost.
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const preamble = matrix
    .slice(0, headerIdx)
    .map((r) => r.filter((c) => c != null && String(c).trim() !== "").join(" ").trim())
    .filter(Boolean);
  const rows: RawRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (r.every((c) => c == null || String(c).trim() === "")) continue; // blank line, not data
    const cells: Record<string, unknown> = {};
    headers.forEach((h, j) => (cells[h] = r[j] ?? null));
    // Extra cells beyond the header row are kept so nothing is silently dropped.
    for (let j = headers.length; j < r.length; j++) if (r[j] != null && String(r[j]).trim() !== "") cells[`Column ${j + 1}`] = r[j];
    rows.push({ sourceRow: `row ${i + firstRowNumber}`, cells });
  }
  return { headers, rows, preamble, headerRowNumber: headerIdx + firstRowNumber };
}

/** The header row is the row (within the first 15) with the most recognised header names. */
function findHeaderRow(matrix: unknown[][]): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < Math.min(15, matrix.length); i++) {
    const r = matrix[i] ?? [];
    const score = r.filter((c) => c != null && KNOWN.has(normaliseHeader(String(c)))).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  if (best >= 0 && bestScore >= 2) return best;
  // Fall back to the first non-empty row.
  return matrix.findIndex((r) => (r ?? []).some((c) => c != null && String(c).trim() !== ""));
}

/** "Account currency: USD" style statements above the table. */
export function currencyFromPreamble(preamble: string[]): string | null {
  for (const line of preamble) {
    const m = line.match(/currency\s*[:\-]?\s*([A-Z]{3})\b/i);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** Plain-text dump of a sheet for LLM extraction of non-transaction spreadsheets. */
export function sheetToText(sheet: Sheet, maxRows = 400): string {
  const lines = [...sheet.preamble, sheet.headers.join(" | ")];
  for (const r of sheet.rows.slice(0, maxRows)) {
    lines.push(`${r.sourceRow}: ${sheet.headers.map((h) => (r.cells[h] == null ? "" : String(r.cells[h]))).join(" | ")}`);
  }
  return lines.join("\n");
}
