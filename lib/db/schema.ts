import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["analyst", "qa", "admin"]);
export const caseStatusEnum = pgEnum("case_status", ["drafting", "approved"]);
export const dispositionEnum = pgEnum("disposition", ["escalate_sar", "close_nfa", "request_info"]);
export const scenarioEnum = pgEnum("scenario", [
  "large_amount",
  "pattern_of_funds",
  "round_dollar",
  "wire_structuring",
]);
export const docTypeEnum = pgEnum("doc_type", [
  "alert_report",
  "transaction_list",
  "kyc_profile",
  "counterparty_details",
  "case_history",
  "rfi_response",
  "other",
]);
export const parseStatusEnum = pgEnum("parse_status", ["pending", "parsed", "partial", "failed"]);
export const issueResolutionEnum = pgEnum("issue_resolution", ["fixed", "excluded", "open"]);
export const directionEnum = pgEnum("direction", ["incoming", "outgoing"]);
export const txnTypeEnum = pgEnum("txn_type", ["wire", "ach", "cash", "cheque", "card", "internal"]);
export const questionEnum = pgEnum("question", ["q1", "q2", "q3", "q4", "q5"]);
export const fieldStatusEnum = pgEnum("field_status", ["ai", "edited", "confirmed"]);
export const relationshipEnum = pgEnum("relationship_type", [
  "supplier",
  "customer",
  "related_party",
  "group_company",
  "individual",
  "unknown",
]);
export const kycFitEnum = pgEnum("kyc_fit", ["fits", "partial", "does_not_fit"]);
export const reviewStatusEnum = pgEnum("review_status", ["agree", "edited", "needs_rfi"]);
export const narrativeKindEnum = pgEnum("narrative_kind", ["ai_draft", "analyst"]);

const money = (name?: string) =>
  name ? numeric(name, { precision: 18, scale: 2, mode: "number" }) : numeric({ precision: 18, scale: 2, mode: "number" });

export const users = pgTable("users", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  email: text().notNull().unique(),
  role: roleEnum().notNull(),
  passwordHash: text("password_hash").notNull(),
  /** Extra permissions, e.g. "view_full_account". Off by default. */
  permissions: jsonb().$type<string[]>().notNull().default([]),
});

export const cases = pgTable(
  "cases",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    alertNumber: text("alert_number").notNull().unique(),
    status: caseStatusEnum().notNull().default("drafting"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    timeToDraftSeconds: integer("time_to_draft_seconds"),
    activeSeconds: integer("active_seconds").notNull().default(0),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true, mode: "date" }),
    reviewStart: date("review_start", { mode: "string" }),
    reviewEnd: date("review_end", { mode: "string" }),
    disposition: dispositionEnum(),
    rationale: text(),
    needsAnalysis: boolean("needs_analysis").notNull().default(true),
    analysedAt: timestamp("analysed_at", { withTimezone: true, mode: "date" }),
    /** Figures from the last analysis run (client total flow, own-account transfers excluded from ranking). */
    analysisMeta: jsonb("analysis_meta").$type<{ clientTotalFlow: number; ownAccount: { count: number; total: number } }>(),
    /** Historical cases generated only to populate the demo dashboard. */
    syntheticHistory: boolean("synthetic_history").notNull().default(false),
  },
  (t) => [index("cases_created_by_idx").on(t.createdBy)],
);

export const subAlerts = pgTable(
  "sub_alerts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    subAlertNumber: text("sub_alert_number").notNull(),
    scenario: scenarioEnum(),
    ruleId: text("rule_id"),
    threshold: text(),
    triggerDetails: text("trigger_details"),
    triggeringTxnCount: integer("triggering_txn_count"),
    sourceRef: text("source_ref"),
    /** The AI-extracted original, written once. Null when the row was added by the analyst. */
    aiValue: jsonb("ai_value"),
  },
  (t) => [index("sub_alerts_case_idx").on(t.caseId)],
);

export const documents = pgTable(
  "documents",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    blobUrl: text("blob_url").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    detectedType: docTypeEnum("detected_type"),
    confirmedType: docTypeEnum("confirmed_type"),
    parseStatus: parseStatusEnum("parse_status").notNull().default("pending"),
    parseError: text("parse_error"),
    pageOrRowCount: integer("page_or_row_count"),
    /** Confidence 0–1 for OCR'd images / classifier. */
    confidence: real(),
    /** Raw validated extraction output (fields with sources), or counterparty-detail rows. */
    extraction: jsonb(),
    /** Analyst-supplied header mapping { field: columnHeader } used when auto-mapping fails. */
    columnMapping: jsonb("column_mapping").$type<Record<string, string>>(),
    /** Document-level currency the analyst confirmed when the file does not state one. */
    currency: text(),
    uploadedBy: integer("uploaded_by")
      .notNull()
      .references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("documents_case_idx").on(t.caseId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** "row 41" for spreadsheets, "p.3" for PDFs/images. */
    sourceRow: text("source_row").notNull(),
    date: date({ mode: "string" }).notNull(),
    transactionId: text("transaction_id").notNull(),
    idGenerated: boolean("id_generated").notNull().default(false),
    direction: directionEnum().notNull(),
    amount: money().notNull(),
    currency: text().notNull(),
    amountBaseCcy: money("amount_base_ccy").notNull(),
    type: txnTypeEnum(),
    counterpartyName: text("counterparty_name"),
    counterpartyAccount: text("counterparty_account"),
    counterpartyBank: text("counterparty_bank"),
    counterpartyBankCountry: text("counterparty_bank_country"),
    originatorCountry: text("originator_country"),
    beneficiaryCountry: text("beneficiary_country"),
    referenceText: text("reference_text"),
    inPeriod: boolean("in_period").notNull().default(true),
  },
  (t) => [index("transactions_case_idx").on(t.caseId), index("transactions_doc_idx").on(t.documentId)],
);

export const parseIssues = pgTable(
  "parse_issues",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** "row 118", "p.2" or "document". */
    sourceRowOrPage: text("source_row_or_page").notNull(),
    /** Normalised field the problem is in (e.g. "amount"), when known. */
    field: text(),
    rawValue: text("raw_value"),
    problem: text().notNull(),
    /** The full raw row so a fix can re-validate it. */
    rawRow: jsonb("raw_row").$type<Record<string, unknown>>(),
    /** Analyst corrections (field → value) applied when the row is re-validated. */
    fixedValues: jsonb("fixed_values").$type<Record<string, string>>(),
    resolution: issueResolutionEnum().notNull().default("open"),
    resolutionReason: text("resolution_reason"),
    resolvedBy: integer("resolved_by").references(() => users.id),
  },
  (t) => [index("parse_issues_doc_idx").on(t.documentId)],
);

export const caseFields = pgTable(
  "case_fields",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    question: questionEnum().notNull(),
    fieldKey: text("field_key").notNull(),
    /** Written once by the extraction step; never overwritten by analyst edits. */
    aiValue: jsonb("ai_value"),
    analystValue: jsonb("analyst_value"),
    sourceRef: text("source_ref"),
    confidence: real(),
    status: fieldStatusEnum().notNull().default("ai"),
  },
  (t) => [uniqueIndex("case_fields_unique").on(t.caseId, t.question, t.fieldKey)],
);

export const counterparties = pgTable(
  "counterparties",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    key: text().notNull(),
    name: text().notNull(),
    rawNames: jsonb("raw_names").$type<string[]>().notNull().default([]),
    account: text(),
    bank: text(),
    bankCountry: text("bank_country"),
    country: text(),
    direction: text().notNull(), // sending | receiving | both
    txnCount: integer("txn_count").notNull(),
    totalAmount: money("total_amount").notNull(),
    pctOfFlow: real("pct_of_flow").notNull(),
    firstDate: date("first_date", { mode: "string" }),
    lastDate: date("last_date", { mode: "string" }),
    score: real().notNull(),
    scoreBreakdown: jsonb("score_breakdown"),
    flags: jsonb().$type<string[]>().notNull().default([]),
    reason: text(),
    rank: integer().notNull(),
    inTop6: boolean("in_top6").notNull().default(false),
    swappedReason: text("swapped_reason"),
    /** Key of the counterparty this one replaced in the top 6 (set on the swapped-in row). */
    swappedFor: text("swapped_for"),
    /** Kept when a re-analysis no longer finds the counterparty in the period. */
    stale: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex("counterparties_case_key").on(t.caseId, t.key)],
);

export const relationshipSummaries = pgTable(
  "relationship_summaries",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    counterpartyId: integer("counterparty_id")
      .notNull()
      .references(() => counterparties.id, { onDelete: "cascade" }),
    relationshipType: relationshipEnum("relationship_type").notNull(),
    relationshipSubtype: text("relationship_subtype"),
    purpose: text(),
    kycFit: kycFitEnum("kyc_fit").notNull(),
    aiText: text("ai_text").notNull(),
    analystText: text("analyst_text"),
    sources: jsonb().$type<string[]>().notNull().default([]),
    reviewStatus: reviewStatusEnum("review_status"),
  },
  (t) => [uniqueIndex("relationship_summaries_unique").on(t.caseId, t.counterpartyId)],
);

export const scenarioFindings = pgTable(
  "scenario_findings",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    scenario: scenarioEnum().notNull(),
    subtype: text().notNull().default(""),
    summary: text().notNull(),
    matchedTxnIds: integer("matched_txn_ids").array().notNull().default([]),
    metrics: jsonb().$type<Record<string, number>>().notNull().default({}),
    params: jsonb().$type<Record<string, number>>().notNull().default({}),
    dismissed: boolean().notNull().default(false),
    dismissReason: text("dismiss_reason"),
    dismissedBy: integer("dismissed_by").references(() => users.id),
  },
  (t) => [uniqueIndex("scenario_findings_unique").on(t.caseId, t.scenario, t.subtype)],
);

export const narratives = pgTable(
  "narratives",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id")
      .notNull()
      .references(() => cases.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    kind: narrativeKindEnum().notNull(),
    contentJson: jsonb("content_json").notNull(),
    contentText: text("content_text").notNull(),
    model: text(),
    promptVersion: text("prompt_version"),
    inputHash: text("input_hash"),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("narratives_case_version").on(t.caseId, t.version)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    caseId: integer("case_id").references(() => cases.id, { onDelete: "cascade" }),
    actorId: integer("actor_id").references(() => users.id),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text("entity_id"),
    before: jsonb(),
    after: jsonb(),
    at: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("audit_case_idx").on(t.caseId, t.at)],
);

export const config = pgTable(
  "config",
  {
    key: text().notNull(),
    value: jsonb().notNull(),
    updatedBy: integer("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.key] })],
);

export type User = typeof users.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type SubAlert = typeof subAlerts.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type ParseIssue = typeof parseIssues.$inferSelect;
export type CaseField = typeof caseFields.$inferSelect;
export type Counterparty = typeof counterparties.$inferSelect;
export type RelationshipSummaryRow = typeof relationshipSummaries.$inferSelect;
export type ScenarioFindingRow = typeof scenarioFindings.$inferSelect;
export type Narrative = typeof narratives.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type DocType = (typeof docTypeEnum.enumValues)[number];
export type Scenario = (typeof scenarioEnum.enumValues)[number];
export type Disposition = (typeof dispositionEnum.enumValues)[number];
