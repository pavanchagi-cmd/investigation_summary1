import { z, type ZodType } from "zod";
import { docTypeEnum } from "@/lib/db/schema";

/** Zod schemas for every Gemini call (spec section 9). The JSON Schema sent to Gemini is generated from these. */

export const Source = z.object({
  file: z.string(),
  page: z.number().int().nullable(),
  row: z.number().int().nullable(),
});

/** `{ value, source: { file, page | row }, confidence }`, value null when not stated. */
export const Field = <T extends ZodType>(value: T) =>
  z.object({ value: value.nullable(), source: Source, confidence: z.number().min(0).max(1) });
export type ExtractedField<T> = { value: T | null; source: z.infer<typeof Source>; confidence: number };

const Str = Field(z.string());
const Int = Field(z.number().int());

export const ScenarioKey = z.enum(["large_amount", "pattern_of_funds", "round_dollar", "wire_structuring"]);

const Account = z.object({ account_number: z.string(), opened_date: z.string().nullable() });

export const AlertReportExtraction = z.object({
  page_count: z.number().int().nullable(),
  alert_number: Str,
  alert_date: Str,
  review_start: Str,
  review_end: Str,
  lookback_days: Int,
  client_name: Str,
  client_id: Str,
  accounts: Field(z.array(Account)),
  sub_alerts: z.array(
    z.object({
      sub_alert_number: z.string(),
      scenario: ScenarioKey.nullable(),
      rule_id: z.string().nullable(),
      threshold: z.string().nullable(),
      trigger_details: z.string().nullable(),
      triggering_txn_count: z.number().int().nullable(),
      page: z.number().int().nullable(),
    }),
  ),
});
export type AlertReportExtraction = z.infer<typeof AlertReportExtraction>;

export const KycExtraction = z.object({
  page_count: z.number().int().nullable(),
  client_name: Str,
  client_id: Str,
  entity_type: Str,
  incorporation_date: Str,
  incorporation_country: Str,
  nature_of_business: Str,
  industry_code: Str,
  declared_turnover: Field(z.object({ amount: z.number(), currency: z.string() })),
  expected_activity: Field(
    z.object({
      monthly_volume: z.number().nullable(),
      monthly_value: z.number().nullable(),
      currency: z.string().nullable(),
      countries: z.array(z.string()),
      products: z.array(z.string()),
    }),
  ),
  accounts: Field(z.array(Account)),
  risk_rating: Str,
  pep: Str,
  sanctions: Str,
  adverse_media: Str,
  prior_alerts: Int,
  prior_sars: Int,
});
export type KycExtraction = z.infer<typeof KycExtraction>;

export const CaseHistoryExtraction = z.object({
  page_count: z.number().int().nullable(),
  prior_alerts: Int,
  prior_sars: Int,
  cases: z.array(
    z.object({
      alert_number: z.string().nullable(),
      date: z.string().nullable(),
      scenario: z.string().nullable(),
      outcome: z.string().nullable(),
      summary: z.string().nullable(),
      page: z.number().int().nullable(),
    }),
  ),
});
export type CaseHistoryExtraction = z.infer<typeof CaseHistoryExtraction>;

export const RfiExtraction = z.object({
  page_count: z.number().int().nullable(),
  response_date: Str,
  respondent: Str,
  summary: Str,
  items: z.array(
    z.object({
      question: z.string().nullable(),
      answer: z.string().nullable(),
      counterparty: z.string().nullable(),
      page: z.number().int().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type RfiExtraction = z.infer<typeof RfiExtraction>;

export const CounterpartyDetailsExtraction = z.object({
  page_count: z.number().int().nullable(),
  rows: z.array(
    z.object({
      name: z.string(),
      account: z.string().nullable(),
      bank: z.string().nullable(),
      bank_country: z.string().nullable(),
      country: z.string().nullable(),
      relationship: z.string().nullable(),
      notes: z.string().nullable(),
      page: z.number().int().nullable(),
      row: z.number().int().nullable(),
    }),
  ),
});
export type CounterpartyDetailsExtraction = z.infer<typeof CounterpartyDetailsExtraction>;

export const OtherExtraction = z.object({ page_count: z.number().int().nullable(), summary: Str });

const S = z.string().nullable();
export const TransactionTableExtraction = z.object({
  page_count: z.number().int().nullable(),
  rows: z.array(
    z.object({
      page: z.number().int(),
      date: S,
      transaction_id: S,
      direction: S,
      debit: S,
      credit: S,
      amount: S,
      currency: S,
      type: S,
      counterparty_name: S,
      counterparty_account: S,
      counterparty_bank: S,
      counterparty_bank_country: S,
      originator_country: S,
      beneficiary_country: S,
      reference_text: S,
    }),
  ),
});
export type TransactionTableExtraction = z.infer<typeof TransactionTableExtraction>;

export const Classification = z.object({
  type: z.enum(docTypeEnum.enumValues),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export const RelationshipSummary = z.object({
  counterpartyId: z.number(),
  relationshipType: z.enum(["supplier", "customer", "related_party", "group_company", "individual", "unknown"]),
  relationshipSubtype: z.string().nullable(),
  purpose: z.string(), // stated or apparent purpose, citing reference text
  kycFit: z.enum(["fits", "partial", "does_not_fit"]),
  summary: z.string().max(600), // 2-4 sentences
  sources: z.array(z.string()), // e.g. 'transactions_Q3.xlsx row 41'
});
export const RelationshipSummaries = z.object({ summaries: z.array(RelationshipSummary) });
export type RelationshipSummary = z.infer<typeof RelationshipSummary>;

/**
 * Narrative sections (owner request, DECISIONS I30): alert and scenarios, the transactions with the six
 * counterparties, and the disposition. Gemini drafts the first two; the disposition section only ever
 * shows the analyst's own choice.
 */
export const SECTION_KEYS = ["alert_overview", "counterparty_summary", "disposition"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** Sections Gemini drafts (and can regenerate). */
export const AI_SECTION_KEYS = ["alert_overview", "counterparty_summary"] as const;
export type AiSectionKey = (typeof AI_SECTION_KEYS)[number];

export const SECTION_HEADINGS: Record<SectionKey, string> = {
  alert_overview: "Alert number and scenarios",
  counterparty_summary: "Transactions with the six counterparties",
  disposition: "Disposition",
};

/** One-word disposition shown in section 3. */
export const DISPOSITION_SHORT: Record<string, string> = {
  close_nfa: "Closed",
  request_info: "RFI",
  escalate_sar: "Escalation",
};
export const DISPOSITION_PENDING = "To be decided by the analyst (choose Closed, RFI or Escalation in the Disposition panel).";

export const NarrativeSection = z.object({ key: z.enum(AI_SECTION_KEYS), heading: z.string(), body: z.string() });
export const NarrativeOutput = z
  .object({ sections: z.array(NarrativeSection) })
  .refine((o) => AI_SECTION_KEYS.every((k) => o.sections.filter((s) => s.key === k).length === 1), {
    message: `Return exactly one section for each key: ${AI_SECTION_KEYS.join(", ")}`,
  });
export type NarrativeOutput = z.infer<typeof NarrativeOutput>;
