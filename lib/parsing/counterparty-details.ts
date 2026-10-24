import { normaliseHeader } from "./headers";
import type { Sheet } from "./spreadsheet";
import { cleanText, parseCountry } from "./values";

export type CounterpartyDetail = {
  name: string;
  account: string | null;
  bank: string | null;
  bank_country: string | null;
  country: string | null;
  relationship: string | null;
  notes: string | null;
  row: number;
};

const SYN: Record<keyof Omit<CounterpartyDetail, "row">, string[]> = {
  name: ["name", "counterparty", "counterparty name", "party name", "beneficiary name"],
  account: ["account", "account number", "account no", "iban", "counterparty account"],
  bank: ["bank", "bank name", "counterparty bank"],
  bank_country: ["bank country", "counterparty bank country"],
  country: ["country", "counterparty country", "domicile", "registered country"],
  relationship: ["relationship", "relationship type", "relation", "stated relationship"],
  notes: ["notes", "remarks", "comments", "description"],
};

/** Code parser for counterparty CSV/XLSX files; unreadable rows become issues, never vanish. */
export function parseCounterpartyDetails(sheet: Sheet) {
  const norm = sheet.headers.map(normaliseHeader);
  const idx = Object.fromEntries(
    Object.entries(SYN).map(([k, syns]) => [k, norm.findIndex((h) => syns.includes(h))]),
  ) as Record<keyof typeof SYN, number>;
  const rows: CounterpartyDetail[] = [];
  const issues: { sourceRowOrPage: string; field: string | null; rawValue: string | null; problem: string; rawRow: Record<string, unknown> }[] = [];
  const cell = (r: Sheet["rows"][number], k: keyof typeof SYN) => (idx[k] >= 0 ? r.cells[sheet.headers[idx[k]]] : null);

  for (const r of sheet.rows) {
    const name = cleanText(cell(r, "name"));
    if (!name) {
      issues.push({ sourceRowOrPage: r.sourceRow, field: "name", rawValue: null, problem: "Counterparty name is missing", rawRow: r.cells });
      continue;
    }
    const bankCountry = parseCountry(cell(r, "bank_country"));
    const country = parseCountry(cell(r, "country"));
    if (!bankCountry.ok || !country.ok) {
      issues.push({
        sourceRowOrPage: r.sourceRow,
        field: !bankCountry.ok ? "bank_country" : "country",
        rawValue: String((!bankCountry.ok ? cell(r, "bank_country") : cell(r, "country")) ?? ""),
        problem: !bankCountry.ok ? bankCountry.problem : (country as { problem: string }).problem,
        rawRow: r.cells,
      });
      continue;
    }
    rows.push({
      name,
      account: cleanText(cell(r, "account")),
      bank: cleanText(cell(r, "bank")),
      bank_country: bankCountry.value,
      country: country.value,
      relationship: cleanText(cell(r, "relationship")),
      notes: cleanText(cell(r, "notes")),
      row: Number(r.sourceRow.replace(/\D/g, "")),
    });
  }
  const used = new Set(Object.values(idx).filter((i) => i >= 0));
  return { rows, issues, unmapped: sheet.headers.filter((_, i) => !used.has(i)) };
}
