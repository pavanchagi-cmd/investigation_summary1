import type { DocType } from "@/lib/db/schema";
import { normaliseHeader } from "./headers";

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  alert_report: "Alert / TM output report",
  transaction_list: "Transaction list",
  kyc_profile: "KYC / CDD profile",
  counterparty_details: "Counterparty details",
  case_history: "Prior alert / case history",
  rfi_response: "RFI response",
  other: "Other",
};

const NAME_RULES: [RegExp, DocType][] = [
  [/(^|[^a-z])rfi([^a-z]|$)|request[ _-]?for[ _-]?info/, "rfi_response"],
  [/kyc|cdd|customer[ _-]?profile|client[ _-]?profile|due[ _-]?diligence/, "kyc_profile"],
  [/counter[ _-]?part(y|ies)|beneficiar(y|ies)[ _-]?list/, "counterparty_details"],
  [/prior[ _-]?(case|alert)|case[ _-]?history|alert[ _-]?history|previous[ _-]?case/, "case_history"],
  [/alert[ _-]?report|tm[ _-]?output|(^|[^a-z])alr[ _-]?\d/, "alert_report"],
  [/transaction|txn|statement|ledger|payments?[ _-]?list/, "transaction_list"],
];

/**
 * Rule-based detection (spec section 5): file-name keywords first, then spreadsheet headers.
 * Returns null when the rules cannot decide (caller falls back to Gemini classification).
 */
export function detectDocType(fileName: string, headers?: string[]): DocType | null {
  const name = fileName.toLowerCase();
  for (const [re, type] of NAME_RULES) if (re.test(name)) return type;
  if (headers && headers.length) {
    const h = headers.map(normaliseHeader);
    const has = (...words: string[]) => h.some((x) => words.some((w) => x === w || x.includes(w)));
    if (has("amount", "debit", "credit") && has("date")) return "transaction_list";
    if (has("counterparty", "beneficiary", "name") && has("bank", "account", "iban", "swift")) return "counterparty_details";
  }
  return null;
}
