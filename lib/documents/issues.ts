import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { documents, parseIssues } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit/log";
import { HttpError } from "@/lib/http";
import { processDocument } from "@/lib/parsing/pipeline";
import type { SessionUser } from "@/lib/auth/guard";

export async function listIssues(caseId: number) {
  const db = await getDb();
  return db
    .select({
      id: parseIssues.id,
      documentId: parseIssues.documentId,
      fileName: documents.fileName,
      sourceRowOrPage: parseIssues.sourceRowOrPage,
      field: parseIssues.field,
      rawValue: parseIssues.rawValue,
      problem: parseIssues.problem,
      rawRow: parseIssues.rawRow,
      fixedValues: parseIssues.fixedValues,
      resolution: parseIssues.resolution,
      resolutionReason: parseIssues.resolutionReason,
    })
    .from(parseIssues)
    .innerJoin(documents, eq(documents.id, parseIssues.documentId))
    .where(eq(documents.caseId, caseId))
    .orderBy(asc(parseIssues.documentId), asc(parseIssues.id));
}
export type IssueRow = Awaited<ReturnType<typeof listIssues>>[number];

async function issueInCase(caseId: number, issueId: number) {
  const db = await getDb();
  const [row] = await db
    .select({ issue: parseIssues, caseId: documents.caseId })
    .from(parseIssues)
    .innerJoin(documents, eq(documents.id, parseIssues.documentId))
    .where(eq(parseIssues.id, issueId));
  if (!row || row.caseId !== caseId) throw new HttpError(404, "Issue not found");
  return row.issue;
}

/** Fix: store corrected values for the row and re-validate it. Returns the row's remaining problems. */
export async function fixIssue(caseId: number, user: SessionUser, issueId: number, values: Record<string, string>) {
  const issue = await issueInCase(caseId, issueId);
  if (issue.sourceRowOrPage === "document") throw new HttpError(400, "Use the column mapping dialog for this issue");
  const db = await getDb();
  const rowIssues = await db
    .select()
    .from(parseIssues)
    .where(and(eq(parseIssues.documentId, issue.documentId), eq(parseIssues.sourceRowOrPage, issue.sourceRowOrPage)));
  const merged = { ...(issue.fixedValues ?? {}), ...values };
  for (const r of rowIssues) {
    await db
      .update(parseIssues)
      .set({ resolution: "fixed", fixedValues: merged, resolvedBy: user.id, resolutionReason: null })
      .where(eq(parseIssues.id, r.id));
  }
  await processDocument(issue.documentId, user.id, { reuseExtraction: true });
  const after = await db
    .select()
    .from(parseIssues)
    .where(and(eq(parseIssues.documentId, issue.documentId), eq(parseIssues.sourceRowOrPage, issue.sourceRowOrPage)));
  const remaining = after.filter((r) => r.resolution === "open").map((r) => r.problem);
  await logAudit({
    caseId,
    actorId: user.id,
    action: "parse_issue_resolved",
    entity: "parse_issue",
    entityId: issueId,
    before: { row: issue.sourceRowOrPage, problem: issue.problem, raw: issue.rawValue },
    after: { resolution: remaining.length ? "still_failing" : "fixed", values: merged },
  });
  return { remaining };
}

export async function excludeIssue(caseId: number, user: SessionUser, issueId: number, reason: string) {
  const issue = await issueInCase(caseId, issueId);
  const db = await getDb();
  await db
    .update(parseIssues)
    .set({ resolution: "excluded", resolutionReason: reason, resolvedBy: user.id })
    .where(and(eq(parseIssues.documentId, issue.documentId), eq(parseIssues.sourceRowOrPage, issue.sourceRowOrPage)));
  await logAudit({
    caseId,
    actorId: user.id,
    action: "parse_issue_resolved",
    entity: "parse_issue",
    entityId: issueId,
    before: { row: issue.sourceRowOrPage, problem: issue.problem, raw: issue.rawValue },
    after: { resolution: "excluded", reason },
  });
  await refreshDocStatus(issue.documentId);
}

/** "Exclude all remaining with reason" – the explicit acceptance of open issues (DECISIONS I9). */
export async function excludeAll(caseId: number, user: SessionUser, documentId: number, reason: string) {
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.caseId, caseId)));
  if (!doc) throw new HttpError(404, "Document not found");
  const open = await db
    .select()
    .from(parseIssues)
    .where(and(eq(parseIssues.documentId, documentId), eq(parseIssues.resolution, "open")));
  if (open.some((i) => i.sourceRowOrPage === "document")) {
    throw new HttpError(400, "Map the missing columns first; a whole file cannot be excluded this way");
  }
  await db
    .update(parseIssues)
    .set({ resolution: "excluded", resolutionReason: reason, resolvedBy: user.id })
    .where(and(eq(parseIssues.documentId, documentId), eq(parseIssues.resolution, "open")));
  await logAudit({
    caseId,
    actorId: user.id,
    action: "parse_issues_bulk_excluded",
    entity: "document",
    entityId: documentId,
    after: { count: open.length, rows: [...new Set(open.map((i) => i.sourceRowOrPage))], reason },
  });
  await refreshDocStatus(documentId);
}

async function refreshDocStatus(documentId: number) {
  const db = await getDb();
  const open = await db
    .select({ id: parseIssues.id })
    .from(parseIssues)
    .where(and(eq(parseIssues.documentId, documentId), eq(parseIssues.resolution, "open")));
  await db.update(documents).set({ parseStatus: open.length ? "partial" : "parsed" }).where(eq(documents.id, documentId));
}
