import type { AlertReportExtraction, CaseHistoryExtraction, KycExtraction, RfiExtraction } from "@/lib/llm/schemas";
import type { SeedAlert } from "./types";

/**
 * Extraction fixtures for GEMINI_MOCK mode, built from each seed alert's ground truth so they
 * match the generated PDF/DOCX/JPG exactly (DECISIONS D7). Page numbers follow the file layouts
 * in lib/seed/files.ts.
 */

export function seedFileNames(a: SeedAlert) {
  const isDesign = a.alertNumber === "ALR-2026-000123";
  return {
    alertReport: `alert_report_${a.alertNumber}.pdf`,
    transactions: "transactions_Q3.xlsx",
    kyc: `kyc_profile_CIF${a.client.cif}.pdf`,
    counterparties: "counterparties.csv",
    priorCases: isDesign ? "prior_cases.docx" : `prior_cases_CIF${a.client.cif}.docx`,
    rfi: isDesign ? "rfi_response_scan.jpg" : `rfi_response_CIF${a.client.cif}.jpg`,
  };
}

const f = <T>(file: string, value: T | null, page: number | null, confidence = 0.98) => ({
  value,
  source: { file, page, row: null },
  confidence,
});

export function alertReportFixture(a: SeedAlert): AlertReportExtraction {
  const file = seedFileNames(a).alertReport;
  return {
    page_count: Math.max(2, ...a.subAlerts.map((s) => s.page)),
    alert_number: f(file, a.alertNumber, 1, 0.99),
    alert_date: f(file, a.alertDate, 1),
    review_start: f(file, a.reviewStart, 1),
    review_end: f(file, a.reviewEnd, 1),
    lookback_days: f(file, a.lookbackDays, 1),
    client_name: f(file, a.client.name, 1),
    client_id: f(file, a.client.cif, 1),
    accounts: f(file, a.client.accounts.map((x) => ({ account_number: x.number, opened_date: x.opened })), 1),
    sub_alerts: a.subAlerts.map((s) => ({
      sub_alert_number: s.number,
      scenario: s.scenario,
      rule_id: s.ruleId,
      threshold: s.threshold,
      trigger_details: s.details,
      triggering_txn_count: s.triggeringCount,
      page: s.page,
    })),
  };
}

export function kycFixture(a: SeedAlert): KycExtraction {
  const file = seedFileNames(a).kyc;
  const c = a.client;
  return {
    page_count: 3,
    client_name: f(file, c.name, 1),
    client_id: f(file, c.cif, 1),
    entity_type: f(file, c.entityType, 1),
    incorporation_date: f(file, c.incorporationDate, 1),
    incorporation_country: f(file, c.incorporationCountry, 1),
    nature_of_business: f(file, c.natureOfBusiness, 2),
    industry_code: c.industryCode ? f(file, c.industryCode, 2) : f(file, null, null, 0),
    declared_turnover: f(file, c.turnover, 2),
    expected_activity: f(
      file,
      { monthly_volume: c.expected.monthlyVolume, monthly_value: c.expected.monthlyValue, currency: c.expected.currency, countries: c.expected.countries, products: c.expected.products },
      3,
    ),
    accounts: f(file, null, null, 0),
    risk_rating: f(file, c.riskRating, 3),
    pep: f(file, c.pep, 3),
    sanctions: f(file, c.sanctions, 3),
    adverse_media: f(file, c.adverseMedia, 3),
    prior_alerts: f(file, c.priorAlerts, 3),
    prior_sars: f(file, c.priorSars, 3),
  };
}

export function caseHistoryFixture(a: SeedAlert): CaseHistoryExtraction {
  const file = seedFileNames(a).priorCases;
  return {
    page_count: null,
    prior_alerts: f(file, a.client.priorAlerts, null, 0.97),
    prior_sars: f(file, a.client.priorSars, null, 0.97),
    cases: a.priorCases.map((p) => ({ alert_number: p.alertNumber, date: p.date, scenario: p.scenario, outcome: p.outcome, summary: p.summary, page: null })),
  };
}

export function rfiFixture(a: SeedAlert): RfiExtraction {
  const file = seedFileNames(a).rfi;
  return {
    page_count: 1,
    response_date: f(file, a.rfi.date, 1, 0.92),
    respondent: f(file, a.rfi.respondent, 1, 0.92),
    summary: f(file, a.rfi.summary, 1, 0.92),
    items: a.rfi.items.map((i) => ({ question: i.question, answer: i.answer, counterparty: i.counterparty, page: 1, confidence: 0.92 })),
  };
}
