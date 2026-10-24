import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { describeAudit } from "./describe";

export async function caseAudit(caseId: number, limit = 500, opts: { includeAi?: boolean } = {}) {
  const db = await getDb();
  const rows = await db
    .select({ e: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(eq(auditLog.caseId, caseId))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit * 3);
  return rows
    .filter((r) => opts.includeAi || r.e.action !== "ai_call")
    .slice(0, limit)
    .map(({ e, actorName }) => ({
      id: e.id,
      at: e.at.toISOString(),
      action: e.action,
      actorName,
      text: describeAudit({ ...e, actorName }),
      before: e.before,
      after: e.after,
    }));
}
export type AuditRow = Awaited<ReturnType<typeof caseAudit>>[number];
