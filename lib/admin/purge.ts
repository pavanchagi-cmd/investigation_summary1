import "server-only";
import { inArray, lt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cases, documents } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { deleteFile } from "@/lib/storage";
import { logAudit } from "@/lib/audit/log";

/** Retention purge for demo data: deletes cases started before the retention window, with their files. */
export async function purgeOldCases(actorId: number | null) {
  const cfg = await getConfig();
  const db = await getDb();
  const cutoff = new Date(Date.now() - cfg.retention_days * 86_400_000);
  const old = await db.select({ id: cases.id }).from(cases).where(lt(cases.startedAt, cutoff));
  if (!old.length) return { cases: 0, files: 0 };
  const ids = old.map((o) => o.id);
  const docs = await db.select({ url: documents.blobUrl }).from(documents).where(inArray(documents.caseId, ids));
  let files = 0;
  for (const d of docs) {
    try {
      await deleteFile(d.url);
      files++;
    } catch {
      /* already gone */
    }
  }
  await db.delete(cases).where(inArray(cases.id, ids)); // cascades to all case data
  await logAudit({ caseId: null, actorId, action: "retention_purge", entity: "case", after: { cases: ids.length, files, days: cfg.retention_days } });
  return { cases: ids.length, files };
}
