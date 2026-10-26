import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cases, parseIssues, documents, subAlerts, transactions, caseFields, type Scenario } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { logAudit } from "@/lib/audit/log";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/lib/auth/guard";

async function validAlertNumber(raw: string) {
  const alertNumber = raw.trim().toUpperCase();
  const cfg = await getConfig();
  if (!new RegExp(cfg.alert_number_regex).test(alertNumber)) {
    throw new HttpError(400, "Alert number must look like ALR-YYYY-NNNNNN", { field: "alertNumber" });
  }
  return alertNumber;
}

export async function createCase(user: SessionUser, alertNumberRaw: string) {
  const alertNumber = await validAlertNumber(alertNumberRaw);
  const db = await getDb();
  const [existing] = await db.select().from(cases).where(eq(cases.alertNumber, alertNumber)).limit(1);
  if (existing) {
    if (existing.createdBy === user.id || user.role !== "analyst") return { case: existing, created: false };
    throw new HttpError(409, "This alert is already being worked by another analyst.");
  }
  const [row] = await db.insert(cases).values({ alertNumber, createdBy: user.id }).returning();
  // Q1 alert number is analyst-entered: stored as a confirmed field.
  await db.insert(caseFields).values({
    caseId: row.id,
    question: "q1",
    fieldKey: "alert_number",
    aiValue: null,
    analystValue: alertNumber,
    status: "confirmed",
  });
  await logAudit({ caseId: row.id, actorId: user.id, action: "case_created", entity: "case", entityId: row.id, after: { alertNumber } });
  return { case: row, created: true };
}

/**
 * Analyst correction of the Q1 alert number (e.g. a typo, or the uploaded report names another alert).
 * Sub-alert numbers built from the old number are renamed unless the new number already exists.
 */
export async function setAlertNumber(caseId: number, user: SessionUser, raw: string) {
  const alertNumber = await validAlertNumber(raw);
  const db = await getDb();
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) throw new HttpError(404, "Case not found");
  if (c.alertNumber === alertNumber) return c;
  const [other] = await db.select({ id: cases.id }).from(cases).where(eq(cases.alertNumber, alertNumber)).limit(1);
  if (other) throw new HttpError(409, `Another case already uses ${alertNumber}. Open that case from My cases instead.`);
  const [row] = await db.update(cases).set({ alertNumber }).where(eq(cases.id, caseId)).returning();
  await db
    .insert(caseFields)
    .values({ caseId, question: "q1", fieldKey: "alert_number", analystValue: alertNumber, status: "confirmed" })
    .onConflictDoUpdate({
      target: [caseFields.caseId, caseFields.question, caseFields.fieldKey],
      set: { analystValue: alertNumber, status: "confirmed" },
    });
  const subs = await db.select().from(subAlerts).where(eq(subAlerts.caseId, caseId));
  const taken = new Set(subs.map((x) => x.subAlertNumber));
  for (const x of subs) {
    if (!x.subAlertNumber.startsWith(`${c.alertNumber}-`)) continue;
    const renamed = alertNumber + x.subAlertNumber.slice(c.alertNumber.length);
    if (taken.has(renamed)) continue;
    await db.update(subAlerts).set({ subAlertNumber: renamed }).where(eq(subAlerts.id, x.id));
    taken.add(renamed);
  }
  await logAudit({
    caseId,
    actorId: user.id,
    action: "alert_number_changed",
    entity: "case",
    entityId: caseId,
    before: { alertNumber: c.alertNumber },
    after: { alertNumber },
  });
  return row;
}

/** Recomputes in_period for every transaction after Q2 changes. */
export async function applyReviewPeriod(caseId: number) {
  const db = await getDb();
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c) return;
  if (!c.reviewStart || !c.reviewEnd) {
    await db.update(transactions).set({ inPeriod: true }).where(eq(transactions.caseId, caseId));
  } else {
    await db
      .update(transactions)
      .set({ inPeriod: sql`${transactions.date} between ${c.reviewStart} and ${c.reviewEnd}` })
      .where(eq(transactions.caseId, caseId));
  }
  await db.update(cases).set({ needsAnalysis: true }).where(eq(cases.id, caseId));
}

export async function setReviewPeriod(caseId: number, user: SessionUser, start: string, end: string) {
  if (start > end) throw new HttpError(400, "Start date must be on or before the end date");
  const db = await getDb();
  const [before] = await db.select().from(cases).where(eq(cases.id, caseId));
  await db.update(cases).set({ reviewStart: start, reviewEnd: end }).where(eq(cases.id, caseId));
  for (const [key, value] of [
    ["review_start", start],
    ["review_end", end],
  ] as const) {
    await db
      .insert(caseFields)
      .values({ caseId, question: "q2", fieldKey: key, analystValue: value, status: "edited" })
      .onConflictDoUpdate({
        target: [caseFields.caseId, caseFields.question, caseFields.fieldKey],
        set: { analystValue: value, status: "edited" },
      });
  }
  await applyReviewPeriod(caseId);
  await logAudit({
    caseId,
    actorId: user.id,
    action: "review_period_set",
    entity: "case",
    entityId: caseId,
    before: { start: before?.reviewStart, end: before?.reviewEnd },
    after: { start, end },
  });
}

export type SubAlertPatch = {
  subAlertNumber?: string;
  scenario?: Scenario | null;
  ruleId?: string | null;
  threshold?: string | null;
  triggerDetails?: string | null;
  triggeringTxnCount?: number | null;
};

export async function addSubAlert(caseId: number, user: SessionUser) {
  const db = await getDb();
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  const existing = await db.select().from(subAlerts).where(eq(subAlerts.caseId, caseId));
  const next = String(existing.length + 1).padStart(2, "0");
  const [row] = await db
    .insert(subAlerts)
    .values({ caseId, subAlertNumber: `${c.alertNumber}-${next}`, sourceRef: "Added by analyst" })
    .returning();
  await logAudit({ caseId, actorId: user.id, action: "sub_alert_added", entity: "sub_alert", entityId: row.id, after: row });
  return row;
}

export async function updateSubAlert(caseId: number, user: SessionUser, id: number, patch: SubAlertPatch) {
  const db = await getDb();
  const [before] = await db
    .select()
    .from(subAlerts)
    .where(and(eq(subAlerts.id, id), eq(subAlerts.caseId, caseId)));
  if (!before) throw new HttpError(404, "Sub-alert not found");
  const [after] = await db.update(subAlerts).set(patch).where(eq(subAlerts.id, id)).returning();
  await logAudit({ caseId, actorId: user.id, action: "sub_alert_edited", entity: "sub_alert", entityId: id, before, after });
  return after;
}

export async function removeSubAlert(caseId: number, user: SessionUser, id: number) {
  const db = await getDb();
  const [before] = await db
    .delete(subAlerts)
    .where(and(eq(subAlerts.id, id), eq(subAlerts.caseId, caseId)))
    .returning();
  if (!before) throw new HttpError(404, "Sub-alert not found");
  await logAudit({ caseId, actorId: user.id, action: "sub_alert_removed", entity: "sub_alert", entityId: id, before });
}

export async function listSubAlerts(caseId: number) {
  const db = await getDb();
  return db.select().from(subAlerts).where(eq(subAlerts.caseId, caseId)).orderBy(asc(subAlerts.subAlertNumber));
}

export async function openIssueCount(caseId: number) {
  const db = await getDb();
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(parseIssues)
    .innerJoin(documents, eq(documents.id, parseIssues.documentId))
    .where(and(eq(documents.caseId, caseId), eq(parseIssues.resolution, "open")));
  return r?.n ?? 0;
}

/** Wall-clock heartbeat: adds the gap since the last beat when it is short (client only beats while active). */
export async function recordHeartbeat(caseId: number) {
  const db = await getDb();
  const now = new Date();
  const [c] = await db.select().from(cases).where(eq(cases.id, caseId));
  if (!c || c.status !== "drafting") return c?.activeSeconds ?? 0;
  const last = c.lastHeartbeatAt?.getTime();
  const gap = last ? Math.round((now.getTime() - last) / 1000) : 0;
  const add = gap > 0 && gap <= 90 ? gap : 0;
  const [row] = await db
    .update(cases)
    .set({ activeSeconds: c.activeSeconds + add, lastHeartbeatAt: now })
    .where(eq(cases.id, caseId))
    .returning({ activeSeconds: cases.activeSeconds });
  return row.activeSeconds;
}
