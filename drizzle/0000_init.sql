CREATE TYPE "public"."case_status" AS ENUM('drafting', 'approved');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint
CREATE TYPE "public"."disposition" AS ENUM('escalate_sar', 'close_nfa', 'request_info');--> statement-breakpoint
CREATE TYPE "public"."doc_type" AS ENUM('alert_report', 'transaction_list', 'kyc_profile', 'counterparty_details', 'case_history', 'rfi_response', 'other');--> statement-breakpoint
CREATE TYPE "public"."field_status" AS ENUM('ai', 'edited', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."issue_resolution" AS ENUM('fixed', 'excluded', 'open');--> statement-breakpoint
CREATE TYPE "public"."kyc_fit" AS ENUM('fits', 'partial', 'does_not_fit');--> statement-breakpoint
CREATE TYPE "public"."narrative_kind" AS ENUM('ai_draft', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."parse_status" AS ENUM('pending', 'parsed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."question" AS ENUM('q1', 'q2', 'q3', 'q4', 'q5');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('supplier', 'customer', 'related_party', 'group_company', 'individual', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('agree', 'edited', 'needs_rfi');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('analyst', 'qa', 'admin');--> statement-breakpoint
CREATE TYPE "public"."scenario" AS ENUM('large_amount', 'pattern_of_funds', 'round_dollar', 'wire_structuring');--> statement-breakpoint
CREATE TYPE "public"."txn_type" AS ENUM('wire', 'ach', 'cash', 'cheque', 'card', 'internal');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer,
	"actor_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_fields" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"question" "question" NOT NULL,
	"field_key" text NOT NULL,
	"ai_value" jsonb,
	"analyst_value" jsonb,
	"source_ref" text,
	"confidence" real,
	"status" "field_status" DEFAULT 'ai' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"alert_number" text NOT NULL,
	"status" "case_status" DEFAULT 'drafting' NOT NULL,
	"created_by" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"time_to_draft_seconds" integer,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"review_start" date,
	"review_end" date,
	"disposition" "disposition",
	"rationale" text,
	"needs_analysis" boolean DEFAULT true NOT NULL,
	"analysed_at" timestamp with time zone,
	"synthetic_history" boolean DEFAULT false NOT NULL,
	CONSTRAINT "cases_alert_number_unique" UNIQUE("alert_number")
);
--> statement-breakpoint
CREATE TABLE "config" (
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "config_key_pk" PRIMARY KEY("key")
);
--> statement-breakpoint
CREATE TABLE "counterparties" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "counterparties_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"raw_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"account" text,
	"bank" text,
	"bank_country" text,
	"country" text,
	"direction" text NOT NULL,
	"txn_count" integer NOT NULL,
	"total_amount" numeric(18, 2) NOT NULL,
	"pct_of_flow" real NOT NULL,
	"first_date" date,
	"last_date" date,
	"score" real NOT NULL,
	"score_breakdown" jsonb,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"rank" integer NOT NULL,
	"in_top6" boolean DEFAULT false NOT NULL,
	"swapped_reason" text,
	"stale" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"blob_url" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"detected_type" "doc_type",
	"confirmed_type" "doc_type",
	"parse_status" "parse_status" DEFAULT 'pending' NOT NULL,
	"parse_error" text,
	"page_or_row_count" integer,
	"confidence" real,
	"extraction" jsonb,
	"column_mapping" jsonb,
	"currency" text,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "narratives" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "narratives_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"version" integer NOT NULL,
	"kind" "narrative_kind" NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"input_hash" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parse_issues" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "parse_issues_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"document_id" integer NOT NULL,
	"source_row_or_page" text NOT NULL,
	"field" text,
	"raw_value" text,
	"problem" text NOT NULL,
	"raw_row" jsonb,
	"resolution" "issue_resolution" DEFAULT 'open' NOT NULL,
	"resolution_reason" text,
	"resolved_by" integer
);
--> statement-breakpoint
CREATE TABLE "relationship_summaries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "relationship_summaries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"counterparty_id" integer NOT NULL,
	"relationship_type" "relationship_type" NOT NULL,
	"relationship_subtype" text,
	"purpose" text,
	"kyc_fit" "kyc_fit" NOT NULL,
	"ai_text" text NOT NULL,
	"analyst_text" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "review_status"
);
--> statement-breakpoint
CREATE TABLE "scenario_findings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scenario_findings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"scenario" "scenario" NOT NULL,
	"subtype" text DEFAULT '' NOT NULL,
	"summary" text NOT NULL,
	"matched_txn_ids" integer[] DEFAULT '{}' NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"dismiss_reason" text,
	"dismissed_by" integer
);
--> statement-breakpoint
CREATE TABLE "sub_alerts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sub_alerts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"sub_alert_number" text NOT NULL,
	"scenario" "scenario",
	"rule_id" text,
	"threshold" text,
	"trigger_details" text,
	"triggering_txn_count" integer,
	"source_ref" text,
	"ai_value" jsonb
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"case_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"source_row" text NOT NULL,
	"date" date NOT NULL,
	"transaction_id" text NOT NULL,
	"id_generated" boolean DEFAULT false NOT NULL,
	"direction" "direction" NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"currency" text NOT NULL,
	"amount_base_ccy" numeric(18, 2) NOT NULL,
	"type" "txn_type",
	"counterparty_name" text,
	"counterparty_account" text,
	"counterparty_bank" text,
	"counterparty_bank_country" text,
	"originator_country" text,
	"beneficiary_country" text,
	"reference_text" text,
	"in_period" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "role" NOT NULL,
	"password_hash" text NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_fields" ADD CONSTRAINT "case_fields_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config" ADD CONSTRAINT "config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narratives" ADD CONSTRAINT "narratives_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narratives" ADD CONSTRAINT "narratives_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_issues" ADD CONSTRAINT "parse_issues_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_issues" ADD CONSTRAINT "parse_issues_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summaries" ADD CONSTRAINT "relationship_summaries_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_summaries" ADD CONSTRAINT "relationship_summaries_counterparty_id_counterparties_id_fk" FOREIGN KEY ("counterparty_id") REFERENCES "public"."counterparties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_findings" ADD CONSTRAINT "scenario_findings_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_findings" ADD CONSTRAINT "scenario_findings_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_alerts" ADD CONSTRAINT "sub_alerts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_case_idx" ON "audit_log" USING btree ("case_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "case_fields_unique" ON "case_fields" USING btree ("case_id","question","field_key");--> statement-breakpoint
CREATE INDEX "cases_created_by_idx" ON "cases" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "counterparties_case_key" ON "counterparties" USING btree ("case_id","key");--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "narratives_case_version" ON "narratives" USING btree ("case_id","version");--> statement-breakpoint
CREATE INDEX "parse_issues_doc_idx" ON "parse_issues" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_summaries_unique" ON "relationship_summaries" USING btree ("case_id","counterparty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_findings_unique" ON "scenario_findings" USING btree ("case_id","scenario","subtype");--> statement-breakpoint
CREATE INDEX "sub_alerts_case_idx" ON "sub_alerts" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "transactions_case_idx" ON "transactions" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "transactions_doc_idx" ON "transactions" USING btree ("document_id");