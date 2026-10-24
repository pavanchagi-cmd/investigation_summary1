import "server-only";
import { after } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { documents, parseIssues, type DocType } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit/log";
import { HttpError } from "@/lib/http";
import { MAX_UPLOAD_BYTES, allowedMime, isOwnStorageUrl, scanUpload } from "@/lib/storage";
import { processDocument } from "@/lib/parsing/pipeline";
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
