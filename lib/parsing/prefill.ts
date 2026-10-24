import "server-only";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, cases, documents, subAlerts, type DocType } from "@/lib/db/schema";
import { formatSourceRef } from "@/lib/source-ref";
import type {
  AlertReportExtraction,
  CaseHistoryExtraction,
  ExtractedField,
  KycExtraction,
} from "@/lib/llm/schemas";

type Q = "q1" | "q2" | "q3";

/** Q3 fields in display order (spec section 6). */
export const Q3_FIELDS = [
  "client_name",
  "client_id",
  "entity_type",
  "incorporation_date",
  "incorporation_country",
  "nature_of_business",
  "industry_code",
  "declared_turnover",
  "expected_activity",
  "accounts",
  "risk_rating",
  "pep",
  "sanctions",
  "adverse_media",
  "prior_alerts_sars",
] as const;
export type Q3Field = (typeof Q3_FIELDS)[number];

/** Fields that must have a value before Generate narrative (DECISIONS I15). */
export const Q3_REQUIRED: Q3Field[] = ["client_name", "client_id", "entity_type", "nature_of_business"];

type Candidate = { value: unknown; source: string | null; confidence: number | null };

function fromField(file: string, f: ExtractedField<unknown> | undefined, note?: string): Candidate | null {
  if (!f || f.value == null || (Array.isArray(f.value) && f.value.length === 0)) return null;
  return {
    value: f.value,
    source: formatSourceRef({ file, page: f.source.page ?? undefined, row: f.source.row ?? undefined, note }),
    confidence: f.confidence,
  };
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds AI values for Q1–Q3 from every parsed document. ai_value is written once: an existing
 * AI value is never overwritten; an empty (null) AI value may be filled while the analyst has
 * not touched the field (DECISIONS I10).
 */
export async function prefillCase(caseId: number) {
  const db = await getDb();
  const docs = await db
    .select()
    .from(documents)
    .where(and(eq(documents.caseId, caseId), isNotNull(documents.extraction)))
    .orderBy(asc(documents.uploadedAt));

  const byType = new Map<DocType, { file: string; data: unknown }[]>();
  for (const d of docs) {
    const ex = d.extraction as { type?: DocType; data?: unknown } | null;
    if (!ex?.type || ex.data === undefined) continue;
    const list = byType.get(ex.type) ?? [];
    list.push({ file: d.fileName, data: ex.data });
    byType.set(ex.type, list);
  }
  const alert = byType.get("alert_report")?.[0] as { file: string; data: AlertReportExtraction } | undefined;
  const kyc = byType.get("kyc_profile")?.[0] as { file: string; data: KycExtraction } | undefined;
  const history = byType.get("case_history")?.[0] as { file: string; data: CaseHistoryExtraction } | undefined;

  const candidates: [Q, string, Candidate | null][] = [];
  const first = (...c: (Candidate | null)[]) => c.find((x) => x != null) ?? null;

  if (alert) {
    candidates.push(["q1", "alert_date", fromField(alert.file, alert.data.alert_date)]);
    candidates.push(["q1", "report_alert_number", fromField(alert.file, alert.data.alert_number)]);
    let start = fromField(alert.file, alert.data.review_start);
    let end = fromField(alert.file, alert.data.review_end);
    const lookback = alert.data.lookback_days;
    if (lookback?.value != null) {
      const note = `"Lookback ${lookback.value} days"`;
      if (start) start.source = formatSourceRef({ file: alert.file, page: lookback.source.page ?? undefined, note });
      if (!start && !end && alert.data.alert_date?.value) {
        // Default to the alert lookback window when no dates are stated (spec section 6).
        const e = addDays(alert.data.alert_date.value, -1);
        const s = addDays(e, -(lookback.value - 1));
        const src = formatSourceRef({ file: alert.file, page: lookback.source.page ?? undefined, note });
        start = { value: s, source: src, confidence: lookback.confidence };
        end = { value: e, source: src, confidence: lookback.confidence };
      }
    }
    candidates.push(["q2", "review_start", start], ["q2", "review_end", end]);
  }

  const k = (key: keyof KycExtraction) => (kyc ? fromField(kyc.file, kyc.data[key] as ExtractedField<unknown>) : null);
  const a = (key: keyof AlertReportExtraction) =>
    alert ? fromField(alert.file, alert.data[key] as ExtractedField<unknown>) : null;

  candidates.push(
    ["q3", "client_name", first(k("client_name"), a("client_name"))],
    ["q3", "client_id", first(k("client_id"), a("client_id"))],
    ["q3", "entity_type", k("entity_type")],
    ["q3", "incorporation_date", k("incorporation_date")],
    ["q3", "incorporation_country", k("incorporation_country")],
    ["q3", "nature_of_business", k("nature_of_business")],
    ["q3", "industry_code", k("industry_code")],
    ["q3", "declared_turnover", k("declared_turnover")],
    ["q3", "expected_activity", k("expected_activity")],
    ["q3", "accounts", first(a("accounts"), k("accounts"))],
    ["q3", "risk_rating", k("risk_rating")],
    ["q3", "pep", k("pep")],
    ["q3", "sanctions", k("sanctions")],
    ["q3", "adverse_media", k("adverse_media")],
  );

  const alertsCount = first(k("prior_alerts"), history ? fromField(history.file, history.data.prior_alerts) : null);
  const sarsCount = first(k("prior_sars"), history ? fromField(history.file, history.data.prior_sars) : null);
  candidates.push([
    "q3",
    "prior_alerts_sars",
    alertsCount || sarsCount
      ? {
          value: { alerts: alertsCount?.value ?? null, sars: sarsCount?.value ?? null },
          source: alertsCount?.source ?? sarsCount?.source ?? null,
          confidence: Math.min(alertsCount?.confidence ?? 1, sarsCount?.confidence ?? 1),
        }
      : null,
  ]);

  const existing = await db.select().from(caseFields).where(eq(caseFields.caseId, caseId));
  const has = new Map(existing.map((f) => [`${f.question}|${f.fieldKey}`, f]));

  // Every Q3 field gets a row (null AI value = "Not provided in documents") once any document is parsed.
  const all: [Q, string, Candidate | null][] = [...candidates];
  if (docs.length) for (const f of Q3_FIELDS) if (!all.some(([q, key]) => q === "q3" && key === f)) all.push(["q3", f, null]);

  for (const [question, fieldKey, cand] of all) {
    const row = has.get(`${question}|${fieldKey}`);
    if (!row) {
      await db.insert(caseFields).values({
        caseId,
        question,
        fieldKey,
        aiValue: cand?.value ?? null,
        sourceRef: cand?.source ?? null,
        confidence: cand?.confidence ?? null,
        status: "ai",
      });
    } else if (row.aiValue == null && cand && row.status === "ai") {
      await db
        .update(caseFields)
        .set({ aiValue: cand.value, sourceRef: cand.source, confidence: cand.confidence })
        .where(eq(caseFields.id, row.id));
    }
  }

  // Review period on the case follows the AI value until the analyst sets it.
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  const q2 = await db
    .select()
    .from(caseFields)
    .where(and(eq(caseFields.caseId, caseId), eq(caseFields.question, "q2")));
  const startF = q2.find((f) => f.fieldKey === "review_start");
  const endF = q2.find((f) => f.fieldKey === "review_end");
  if (c && !c.reviewStart && startF?.aiValue && endF?.aiValue && startF.status === "ai" && endF.status === "ai") {
    await db
      .update(cases)
      .set({ reviewStart: String(startF.aiValue), reviewEnd: String(endF.aiValue) })
      .where(eq(cases.id, caseId));
  }

  // Sub-alerts from the alert report, inserted once.
  if (alert && alert.data.sub_alerts.length) {
    const current = await db.select().from(subAlerts).where(eq(subAlerts.caseId, caseId));
    if (!current.some((s) => s.aiValue != null)) {
      for (const s of alert.data.sub_alerts) {
        if (current.some((x) => x.subAlertNumber === s.sub_alert_number)) continue;
        await db.insert(subAlerts).values({
          caseId,
          subAlertNumber: s.sub_alert_number,
          scenario: s.scenario,
          ruleId: s.rule_id,
          threshold: s.threshold,
          triggerDetails: s.trigger_details,
          triggeringTxnCount: s.triggering_txn_count,
          sourceRef: formatSourceRef({ file: alert.file, page: s.page ?? undefined }),
          aiValue: s,
        });
      }
    }
  }
}
