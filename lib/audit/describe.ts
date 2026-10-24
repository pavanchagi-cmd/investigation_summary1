/** Human-readable one-liners for audit events (screen 4 trail, full log, QA view). */
type Entry = { action: string; entity: string; entityId: string | null; before: unknown; after: unknown; actorName: string | null };

const short = (name: string | null) => {
  if (!name) return "System";
  const p = name.trim().split(/\s+/);
  return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : name;
};

const SCEN: Record<string, string> = {
  large_amount: "Large Amount",
  pattern_of_funds: "Pattern of Funds",
  round_dollar: "Round Dollar",
  wire_structuring: "Wire Structuring",
};

export function describeAudit(e: Entry): string {
  const who = short(e.actorName);
  const a = (e.after ?? {}) as Record<string, unknown>;
  const b = (e.before ?? {}) as Record<string, unknown>;
  switch (e.action) {
    case "case_created":
      return `${who} created the case (${a.alertNumber})`;
    case "document_uploaded":
      return `${who} uploaded ${a.fileName}`;
    case "document_type_changed":
      return `${who} changed a document type: ${b.type ?? "undetected"} → ${a.type}`;
    case "document_reparsed":
      return `${who} re-parsed a document`;
    case "column_mapping_set":
      return `${who} set the column mapping / currency for a document`;
    case "parse_issue_resolved":
      return `${who} ${a.resolution === "excluded" ? `excluded ${b.row}: "${a.reason}"` : a.resolution === "fixed" ? `fixed ${b.row}` : `tried to fix ${b.row} (still failing)`}`;
    case "parse_issues_bulk_excluded":
      return `${who} excluded ${a.count} issue(s) with reason "${a.reason}"`;
    case "field_edited":
      return `${who} ${a.status === "confirmed" ? "confirmed" : "edited"} ${String(a.question ?? "").toUpperCase()} ${String(a.field ?? "").replace(/_/g, " ")}`;
    case "sub_alert_added":
      return `${who} added a sub-alert`;
    case "sub_alert_edited":
      return `${who} edited sub-alert ${(a as { subAlertNumber?: string }).subAlertNumber ?? ""}`.trim();
    case "sub_alert_removed":
      return `${who} removed sub-alert ${(b as { subAlertNumber?: string }).subAlertNumber ?? ""}`.trim();
    case "review_period_set":
      return `${who} set the review period ${a.start} – ${a.end}`;
    case "analysis_run":
      return `Scenario rules and ranking ran (${(a.findings as unknown[] | undefined)?.length ?? 0} findings, ${a.counterparties ?? 0} counterparties)`;
    case "counterparty_swapped":
      return `${who} swapped ${b.top6} for ${a.top6}: "${a.reason}"`;
    case "flag_dismissed":
      return `${who} dismissed ${SCEN[String(a.scenario)] ?? "a"} flag: "${a.reason}"`;
    case "flag_restored":
      return `${who} restored ${SCEN[String(a.scenario)] ?? "a"} flag`;
    case "q5_generated":
      return `Q5 summaries drafted by AI (${a.count})`;
    case "q5_status_set":
      return `${who} set a Q5 summary to ${String(a.status).replace("_", " ")}`;
    case "q5_edited":
      return `${who} edited a Q5 summary`;
    case "ai_call":
      return `AI call: ${a.task} · ${a.model} · ${a.prompt_version} · ${a.latency_ms} ms${a.outcome !== "ok" ? ` · ${a.outcome}` : ""}`;
    case "narrative_generated":
      return `AI draft v1 generated (Prompt B, ${a.prompt_version})`;
    case "narrative_saved": {
      const secs = (a.changed_sections as string[] | undefined) ?? [];
      const nums = secs.map((s) => `§${s.split(".")[0]}`).join(" and ");
      return `${who} ${a.reason ? `saved v${a.version} (${a.reason})` : `edited ${nums || "the narrative"} (+${a.added_words} / −${a.removed_words})`}`;
    }
    case "section_regenerated":
      return `${who} regenerated section ${a.section}`;
    case "disposition_set":
      return `${who} set disposition: ${a.disposition ?? "none"}`;
    case "narrative_approved":
      return `${who} approved the narrative (v${a.final_version})`;
    case "narrative_unlocked":
      return `${who} unlocked the narrative: "${a.reason}"`;
    case "exported":
      return `${who} exported ${String(a.format).toUpperCase()}`;
    case "config_updated":
      return `${who} updated setting ${e.entityId}`;
    case "user_role_changed":
      return `${who} changed a user's role to ${a.role}`;
    case "retention_purge":
      return `${who} purged ${a.cases} case(s) older than ${a.days} days`;
    default:
      return `${who}: ${e.action}`;
  }
}
