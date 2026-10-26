import "server-only";
import { after } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, cases, documents, parseIssues, subAlerts, transactions, type DocType } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit/log";
import { HttpError } from "@/lib/http";
import { MAX_UPLOAD_BYTES, allowedMime, deleteFile, isOwnStorageUrl, scanUpload } from "@/lib/storage";
import { processDocument } from "@/lib/parsing/pipeline";
import { prefillCase } from "@/lib/parsing/prefill";
import { applyReviewPeriod } from "@/lib/cases/service";
import type { SessionUser } from "@/lib/auth/guard";

export async function registerDocument(
  caseId: number,
  user: SessionUser,
  input: { blobUrl: string; fileName: string; sizeBytes: number },
  opts: { background?: boolean } = { background: true },
) {
  const mime = allowedMime(input.fileName);
  if (!mime) throw new HttpError(400, `${input.fileName}: only PDF, XLSX, XLS, CSV, DOCX, PNG and JPG files are accepted`);
  if (input.sizeBytes > MAX_UPLOAD_BYTES) throw new HttpError(400, `${input.fileName}: larger than 25 MB`);
  if (!isOwnStorageUrl(input.blobUrl)) throw new HttpError(400, "Upload location not recognised");
  const rejected = await scanUpload({ fileName: input.fileName, size: input.sizeBytes, url: input.blobUrl });
  if (rejected) throw new HttpError(400, rejected);

  const db = await getDb();
  const [doc] = await db
    .insert(documents)
    .values({
      caseId,
      blobUrl: input.blobUrl,
      fileName: input.fileName,
      mimeType: mime,
      sizeBytes: input.sizeBytes,
      uploadedBy: user.id,
    })
    .returning();
  await logAudit({
    caseId,
    actorId: user.id,
    action: "document_uploaded",
    entity: "document",
    entityId: doc.id,
    after: { fileName: doc.fileName, sizeBytes: doc.sizeBytes, mimeType: mime },
  });
  if (opts.background) after(() => processDocument(doc.id, user.id));
  else await processDocument(doc.id, user.id);
  return doc;
}

export async function listDocuments(caseId: number) {
  const db = await getDb();
  const docs = await db.select().from(documents).where(eq(documents.caseId, caseId)).orderBy(asc(documents.uploadedAt));
  const issues = await db
    .select({ documentId: parseIssues.documentId, resolution: parseIssues.resolution, n: sql<number>`count(*)::int` })
    .from(parseIssues)
    .innerJoin(documents, eq(documents.id, parseIssues.documentId))
    .where(eq(documents.caseId, caseId))
    .groupBy(parseIssues.documentId, parseIssues.resolution);
  return docs.map((d) => {
    const counts = { open: 0, fixed: 0, excluded: 0 };
    for (const i of issues) if (i.documentId === d.id) counts[i.resolution] = i.n;
    const ex = d.extraction as { needsMapping?: boolean; missing?: string[]; headers?: string[] } | null;
    return {
      id: d.id,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      detectedType: d.detectedType,
      confirmedType: d.confirmedType,
      type: (d.confirmedType ?? d.detectedType) as DocType | null,
      parseStatus: d.parseStatus,
      parseError: d.parseError,
      pageOrRowCount: d.pageOrRowCount,
      confidence: d.confidence,
      currency: d.currency,
      needsMapping: !!ex?.needsMapping,
      missingColumns: ex?.missing ?? [],
      headers: ex?.headers ?? [],
      columnMapping: d.columnMapping,
      issues: counts,
      uploadedAt: d.uploadedAt.toISOString(),
    };
  });
}
export type DocumentSummary = Awaited<ReturnType<typeof listDocuments>>[number];

export async function getCaseDocument(caseId: number, documentId: number) {
  const db = await getDb();
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.caseId, caseId)));
  if (!doc) throw new HttpError(404, "Document not found");
  return doc;
}

/**
 * Analyst removes a document from the case. Its transactions and parse issues go with it (FK
 * cascade); AI pre-fills and sub-alerts read from it are cleared and rebuilt from the remaining
 * documents. Fields the analyst already confirmed or edited keep the analyst's value.
 */
export async function removeDocument(caseId: number, user: SessionUser, documentId: number) {
  const doc = await getCaseDocument(caseId, documentId);
  const db = await getDb();
  const fromThisFile = (ref: string | null) => ref === doc.fileName || !!ref?.startsWith(`${doc.fileName} · `);

  const [{ n: txnCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(transactions)
    .where(eq(transactions.documentId, doc.id));

  const fields = await db.select().from(caseFields).where(eq(caseFields.caseId, caseId));
  const cleared = fields.filter((f) => f.status === "ai" && fromThisFile(f.sourceRef));
  for (const f of cleared) {
    await db.update(caseFields).set({ aiValue: null, sourceRef: null, confidence: null }).where(eq(caseFields.id, f.id));
  }
  // A review period that only came from this file's AI values is unset, so the remaining documents can set it.
  if (cleared.some((f) => f.question === "q2")) {
    await db.update(cases).set({ reviewStart: null, reviewEnd: null }).where(eq(cases.id, caseId));
  }
  const subs = (await db.select().from(subAlerts).where(eq(subAlerts.caseId, caseId))).filter(
    (x) => x.aiValue != null && fromThisFile(x.sourceRef),
  );
  for (const x of subs) await db.delete(subAlerts).where(eq(subAlerts.id, x.id));

  await db.delete(documents).where(eq(documents.id, doc.id));
  await logAudit({
    caseId,
    actorId: user.id,
    action: "document_removed",
    entity: "document",
    entityId: doc.id,
    before: { fileName: doc.fileName, type: doc.confirmedType ?? doc.detectedType },
    after: { transactions: txnCount, clearedFields: cleared.length, subAlerts: subs.length },
  });
  await prefillCase(caseId);
  await applyReviewPeriod(caseId);
  try {
    await deleteFile(doc.blobUrl);
  } catch {
    // The case no longer references the file; log the id (never the contents) so it can be cleaned up by hand.
    console.error(`[documents] could not delete stored file for document ${doc.id}`);
  }
}
