import { NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { docTypeEnum, documents } from "@/lib/db/schema";
import { HttpError, idParam, parseBody, route } from "@/lib/http";
import { logAudit } from "@/lib/audit/log";
import { processDocument } from "@/lib/parsing/pipeline";
import { removeDocument } from "@/lib/documents/service";
import { TXN_FIELDS } from "@/lib/parsing/headers";
import { ISO_CURRENCIES } from "@/lib/parsing/values";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

const Patch = z
  .object({
    /** Read the document again (e.g. after Gemini failed). */
    reparse: z.literal(true).optional(),
    confirmedType: z.enum(docTypeEnum.enumValues).optional(),
    columnMapping: z.record(z.enum(TXN_FIELDS), z.string().max(200)).optional(),
    currency: z
      .string()
      .refine((c) => ISO_CURRENCIES.has(c), "Not an ISO 4217 code")
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, "Nothing to change");

export const PATCH = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const db = await getDb();
  const id = idParam((await params).id);
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) throw new HttpError(404, "Document not found");
  await getEditableCase(doc.caseId, user);
  const body = await parseBody(req, Patch);

  if (body.reparse) {
    await logAudit({ caseId: doc.caseId, actorId: user.id, action: "document_reparsed", entity: "document", entityId: id, before: { status: doc.parseStatus } });
  }
  if (body.confirmedType) {
    await db.update(documents).set({ confirmedType: body.confirmedType }).where(eq(documents.id, id));
    await logAudit({
      caseId: doc.caseId,
      actorId: user.id,
      action: "document_type_changed",
      entity: "document",
      entityId: id,
      before: { type: doc.confirmedType ?? doc.detectedType },
      after: { type: body.confirmedType },
    });
  }
  if (body.columnMapping || body.currency) {
    await db
      .update(documents)
      .set({
        ...(body.columnMapping ? { columnMapping: body.columnMapping } : {}),
        ...(body.currency ? { currency: body.currency } : {}),
      })
      .where(eq(documents.id, id));
    await logAudit({
      caseId: doc.caseId,
      actorId: user.id,
      action: "column_mapping_set",
      entity: "document",
      entityId: id,
      before: { columnMapping: doc.columnMapping, currency: doc.currency },
      after: { columnMapping: body.columnMapping ?? doc.columnMapping, currency: body.currency ?? doc.currency },
    });
  }
  // A type change needs fresh extraction; mapping/currency changes re-validate the rows already read.
  const reuse = !body.reparse && (!body.confirmedType || body.confirmedType === (doc.confirmedType ?? doc.detectedType));
  await db.update(documents).set({ parseStatus: "pending" }).where(eq(documents.id, id));
  after(() => processDocument(id, user.id, { reuseExtraction: reuse }));
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const db = await getDb();
  const id = idParam((await params).id);
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) throw new HttpError(404, "Document not found");
  await getEditableCase(doc.caseId, user);
  await removeDocument(doc.caseId, user, id);
  return NextResponse.json({ ok: true });
});
