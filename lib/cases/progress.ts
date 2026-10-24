import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, counterparties, documents, narratives, relationshipSummaries, subAlerts, type Case } from "@/lib/db/schema";
import { Q3_REQUIRED } from "@/lib/parsing/prefill";
import { openIssueCount } from "./service";

const LABELS: Record<string, string> = {
  client_name: "client name",
  client_id: "client ID / CIF",
  entity_type: "entity type",
  nature_of_business: "nature of business",
};

export type Progress = {
  stepsDone: [boolean, boolean, boolean, boolean];
  /** Why Generate narrative is disabled (empty when it can run). */
  narrativeBlockers: string[];
  /** Why Approve is disabled, beyond disposition/rationale. */
  approveBlockers: string[];
  openIssues: number;
  hasNarrative: boolean;
};

export async function getProgress(c: Case): Promise<Progress> {
  const db = await getDb();
  const [subs, fields, cps, sums, docs, nars, openIssues] = await Promise.all([
    db.select().from(subAlerts).where(eq(subAlerts.caseId, c.id)),
    db.select().from(caseFields).where(and(eq(caseFields.caseId, c.id), eq(caseFields.question, "q3"))),
    db.select().from(counterparties).where(and(eq(counterparties.caseId, c.id), eq(counterparties.stale, false))),
    db.select().from(relationshipSummaries).where(eq(relationshipSummaries.caseId, c.id)),
    db.select({ status: documents.parseStatus }).from(documents).where(eq(documents.caseId, c.id)),
    db.select({ id: narratives.id }).from(narratives).where(eq(narratives.caseId, c.id)).limit(1),
    openIssueCount(c.id),
  ]);

  const q1 = subs.length > 0 && subs.every((s) => s.scenario);
  const q2 = !!c.reviewStart && !!c.reviewEnd && c.reviewStart <= c.reviewEnd;
  const missingQ3 = Q3_REQUIRED.filter((k) => {
    const f = fields.find((x) => x.fieldKey === k);
    const v = f?.analystValue ?? f?.aiValue;
    return v == null || v === "";
  });
  const top = cps.filter((x) => x.inTop6);
  const q4 = cps.length > 0 && top.length === Math.min(6, cps.length) && !c.needsAnalysis;
  const pending = docs.some((d) => d.status === "pending");
  const topIds = new Set(top.map((t) => t.id));
  const q5Statuses = sums.filter((s) => topIds.has(s.counterpartyId));
  const q5Done = top.length > 0 && q5Statuses.length === top.length && q5Statuses.every((s) => s.reviewStatus);

  const blockers: string[] = [];
  if (!docs.length) blockers.push("Upload the alert's documents");
  if (pending) blockers.push("Wait for documents to finish parsing");
  if (!q1) blockers.push("Q1: add at least one sub-alert and choose a scenario for each");
  if (!q2) blockers.push("Q2: set a review period (start ≤ end)");
  if (missingQ3.length) blockers.push(`Q3: add ${missingQ3.map((k) => LABELS[k] ?? k).join(", ")}`);
  if (!q4) blockers.push(cps.length ? "Q4: re-run the analysis (data changed)" : "Q4: no in-period transactions to rank yet");
  if (openIssues) blockers.push(`Resolve ${openIssues} open parse issue${openIssues === 1 ? "" : "s"} (fix or exclude with reason)`);

  const approveBlockers: string[] = [];
  if (!nars.length) approveBlockers.push("Generate the narrative at least once");
  if (!q5Done) approveBlockers.push("Set Agree / Edited / Needs RFI on every Q5 summary");

  return {
    stepsDone: [q1 && q2 && docs.length > 0 && !pending, missingQ3.length === 0 && q4, q5Done, c.status === "approved"],
    narrativeBlockers: blockers,
    approveBlockers,
    openIssues,
    hasNarrative: nars.length > 0,
  };
}
