/**
 * Deterministic stand-ins for Gemini calls 3 and 4 in GEMINI_MOCK mode (tests, CI, demos without a
 * key). They only restate facts from the structured input, like the real prompts require.
 */
import type { NarrativeOutput, RelationshipSummary } from "./schemas";
import { SECTION_HEADINGS, SECTION_KEYS, type SectionKey } from "./schemas";
import { formatFieldValue } from "../display";

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const d = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "not provided in the documents");

type Q5Cp = {
  counterpartyId: number;
  name: string;
  direction_relative_to_client: string;
  country: string | null;
  txn_count: number;
  total_amount: number;
  currency: string;
  pct_of_client_flow: number;
  first_date: string;
  last_date: string;
  risk_flags: string[];
  scenario_links: { scenario: string; dismissed: boolean; matched_txns_with_this_counterparty: number }[];
  reference_texts: { text: string; count: number }[];
  stated_relationship: { relationship: string | null; notes: string | null; source: string } | null;
  rfi_answers: { answer: string | null; source: string }[];
  transaction_source: string | null;
};
type Q5In = { client_kyc: { expected_activity?: unknown }; counterparties: Q5Cp[] };

const SCEN: Record<string, string> = {
  wire_structuring: "wire structuring",
  pattern_of_funds: "pattern of funds",
  round_dollar: "round-amount",
  large_amount: "large-amount",
};

export function mockQ5(input: unknown): { summaries: RelationshipSummary[] } {
  const inp = input as Q5In;
  const expected = inp.client_kyc.expected_activity as { countries?: string[] } | null;
  const countries = expected?.countries ?? [];
  return {
    summaries: inp.counterparties.map((c) => {
      const rel = c.stated_relationship?.relationship?.toLowerCase() ?? "";
      const relationshipType: RelationshipSummary["relationshipType"] = /individual/.test(rel)
        ? "individual"
        : /supplier|freight|shipping|forwarder|haulage|consumable|vendor/.test(rel)
          ? "supplier"
          : /customer/.test(rel)
            ? "customer"
            : /own account/.test(rel)
              ? "related_party"
              : "unknown";
      const subtype = /freight|forwarder|shipping|haulage/.test(rel) ? "logistics" : /metal/.test(rel) ? "metals" : null;
      const risky = c.risk_flags.some((f) => /high-risk|weak/i.test(f));
      const inExpected = c.country ? countries.includes(c.country) : false;
      const linked = c.scenario_links.filter((s) => !s.dismissed);
      const kycFit: RelationshipSummary["kycFit"] = risky || relationshipType === "unknown" ? "does_not_fit" : inExpected && !linked.length ? "fits" : "partial";
      const refs = c.reference_texts.slice(0, 2).map((r) => `"${r.text}"`);
      const purpose = refs.length ? `References read ${refs.join(" and ")}.` : "No purpose stated in the transaction references.";
      const parts = [
        `${c.name} ${c.direction_relative_to_client}: ${c.txn_count} transactions totalling ${c.currency} ${fmt(c.total_amount)} (${c.pct_of_client_flow.toFixed(1)}% of flow) between ${d(c.first_date)} and ${d(c.last_date)}.`,
        c.stated_relationship?.relationship ? `Stated relationship: ${c.stated_relationship.relationship}.` : "Relationship not provided in the documents.",
        purpose,
        linked.length ? `Linked to ${linked.map((s) => `${SCEN[s.scenario] ?? s.scenario} (${s.matched_txns_with_this_counterparty} txns)`).join(", ")}.` : null,
        kycFit === "fits" ? "Consistent with the client's expected countries and activity." : kycFit === "partial" ? "Partly consistent with the client's KYC; the red-flag links are not explained by the documents." : "Not consistent with the client's KYC on the information provided.",
      ].filter(Boolean);
      const summary = parts.join(" ").slice(0, 600);
      return {
        counterpartyId: c.counterpartyId,
        relationshipType,
        relationshipSubtype: subtype,
        purpose,
        kycFit,
        summary,
        sources: [c.transaction_source, c.stated_relationship?.source, ...c.rfi_answers.map((a) => a.source)].filter((s): s is string => !!s),
      };
    }),
  };
}

type NarrIn = {
  alert: { alert_number: string; alert_date?: string | null };
  sub_alerts: { sub_alert_number: string; scenario: string | null; rule_id: string | null }[];
  review_period: { start: string | null; end: string | null; in_period_txn_count: number; total_flow: number; currency: string; excluded_txn_count: number };
  client_kyc: Record<string, unknown>;
  counterparties_top6: { name: string; total_amount: number; pct_of_client_flow: number; direction: string; flags: string[] }[];
  relationship_summaries: { counterparty: string; summary: string; review_status: string | null }[];
  scenario_findings: { scenario: string; summary: string; matched_count: number; dismissed: boolean; dismiss_reason: string | null }[];
  analyst_notes?: string;
  section_key?: SectionKey;
};

const NAMES: Record<string, string> = {
  wire_structuring: "Wire Structuring",
  pattern_of_funds: "Pattern of Funds",
  round_dollar: "Round Dollar Transaction",
  large_amount: "Large Amount Transaction",
};

function sectionBody(key: SectionKey, i: NarrIn): string {
  const k = i.client_kyc;
  const field = (key: string) => {
    const v = k[key];
    return v == null || v === "" ? "not provided in the documents" : formatFieldValue(key, v);
  };
  const rp = i.review_period;
  const active = i.scenario_findings.filter((f) => !f.dismissed);
  const dismissed = i.scenario_findings.filter((f) => f.dismissed);
  switch (key) {
    case "alert_overview":
      return `Alert ${i.alert.alert_number} was generated on ${d(i.alert.alert_date)} with ${i.sub_alerts.length} sub-alert${i.sub_alerts.length === 1 ? "" : "s"}: ${i.sub_alerts
        .map((s) => `${NAMES[s.scenario ?? ""] ?? "unspecified scenario"}${s.rule_id ? ` (${s.rule_id})` : ""}`)
        .join(", ")}. The review period is ${d(rp.start)} to ${d(rp.end)} (${rp.in_period_txn_count} transactions, ${rp.currency} ${fmt(rp.total_flow)}); ${rp.excluded_txn_count} transactions outside the period were excluded.`;
    case "client_profile":
      return `${field("client_name")} (CIF ${field("client_id")}) is recorded as ${field("entity_type")}, with nature of business: ${field("nature_of_business")}. Risk rating: ${field("risk_rating")}. PEP: ${field("pep")}. Sanctions: ${field("sanctions")}. Adverse media: ${field("adverse_media")}.`;
    case "activity_summary":
      return `Total in-period flow was ${rp.currency} ${fmt(rp.total_flow)} across ${rp.in_period_txn_count} transactions between ${d(rp.start)} and ${d(rp.end)}. Expected activity per KYC: ${field("expected_activity")}.`;
    case "counterparty_analysis": {
      const share = i.counterparties_top6.reduce((s, c) => s + c.pct_of_client_flow, 0);
      return `The six counterparties reviewed account for ${share.toFixed(1)}% of flow.\n\n${i.counterparties_top6
        .map((c) => `${c.name}: ${rp.currency} ${fmt(c.total_amount)} (${c.pct_of_client_flow.toFixed(1)}%), ${c.direction}${c.flags.length ? `; flags ${c.flags.join(", ")}` : ""}.`)
        .join("\n\n")}`;
    }
    case "red_flags":
      return [
        ...active.map((f) => `${NAMES[f.scenario]}: ${f.summary}`),
        ...dismissed.map((f) => `${NAMES[f.scenario]} was reviewed and dismissed by the analyst: "${f.dismiss_reason}".`),
      ].join("\n\n") || "No scenario findings were raised.";
    case "typology_assessment":
      return active.length
        ? `The activity resembles ${active.map((f) => ({ wire_structuring: "threshold-avoidance structuring", pattern_of_funds: "pass-through layering", round_dollar: "round-amount payments", large_amount: "unusually large transactions" })[f.scenario as "large_amount"]).join(" and ")}. This describes a resemblance only; it does not establish that money laundering occurred.`
        : "No typology is indicated by the findings that remain after the analyst's review.";
    case "information_gaps": {
      const gaps = Object.entries(k).filter(([, v]) => v == null || v === "" || v === "not provided in the documents").map(([key]) => key.replace(/_/g, " "));
      const rfi = i.relationship_summaries.filter((s) => s.review_status === "needs_rfi").map((s) => s.counterparty);
      return [gaps.length ? `Not provided in the documents: ${gaps.join(", ")}.` : null, rfi.length ? `Further information is needed on: ${rfi.join(", ")}.` : null].filter(Boolean).join(" ") || "No information gaps were identified in the input.";
    }
    case "analyst_considerations":
      return `Factors for escalation: ${active.length ? active.map((f) => `${NAMES[f.scenario]} (${f.matched_count} matched transactions)`).join("; ") : "none recorded"}.\n\nFactors against escalation: ${dismissed.length ? dismissed.map((f) => `${NAMES[f.scenario]} dismissed with reason "${f.dismiss_reason}"`).join("; ") : "none recorded in the input"}. The disposition is for the analyst to decide.`;
  }
}

export function mockNarrative(input: unknown): NarrativeOutput {
  const i = input as NarrIn;
  return { sections: SECTION_KEYS.map((key) => ({ key, heading: SECTION_HEADINGS[key], body: sectionBody(key, i) })) };
}

export function mockNarrativeSection(input: unknown): { key: SectionKey; heading: string; body: string } {
  const i = input as NarrIn;
  const key = i.section_key ?? "alert_overview";
  return { key, heading: SECTION_HEADINGS[key], body: sectionBody(key, i) };
}
