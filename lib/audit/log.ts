import "server-only";
import { getDb, type Db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export type AuditAction =
  | "case_created"
  | "alert_number_changed"
  | "document_uploaded"
  | "document_removed"
  | "document_type_changed"
  | "document_reparsed"
  | "column_mapping_set"
  | "parse_issue_resolved"
  | "parse_issues_bulk_excluded"
  | "field_edited"
  | "sub_alert_added"
  | "sub_alert_edited"
  | "sub_alert_removed"
  | "review_period_set"
  | "analysis_run"
  | "counterparty_swapped"
  | "flag_dismissed"
  | "flag_restored"
  | "q5_generated"
  | "q5_status_set"
  | "q5_edited"
  | "ai_call"
  | "narrative_generated"
  | "narrative_saved"
  | "section_regenerated"
  | "disposition_set"
  | "narrative_approved"
  | "narrative_unlocked"
  | "exported"
  | "config_updated"
  | "user_role_changed"
  | "retention_purge";

export type AuditInput = {
  caseId: number | null;
  actorId: number | null;
  action: AuditAction;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
};

/** The single entry point for audit events. Never log document contents or prompts here. */
export async function logAudit(input: AuditInput, tx?: Db) {
  const db = tx ?? (await getDb());
  await db.insert(auditLog).values({
    caseId: input.caseId,
    actorId: input.actorId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId == null ? null : String(input.entityId),
    before: input.before ?? null,
    after: input.after ?? null,
  });
}
