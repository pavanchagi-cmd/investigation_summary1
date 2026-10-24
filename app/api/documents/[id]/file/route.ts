import { eq } from "drizzle-orm";
import { ALL_ROLES, getCaseForUser, requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { HttpError, idParam, route } from "@/lib/http";
import { readFile } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

/** Streams a private document after checking case access; storage URLs never reach the browser. */
export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const db = await getDb();
  const [doc] = await db.select().from(documents).where(eq(documents.id, idParam((await params).id)));
  if (!doc) throw new HttpError(404, "Document not found");
  await getCaseForUser(doc.caseId, user);
  const body = await readFile(doc.blobUrl);
  const inline = ["application/pdf", "image/png", "image/jpeg"].includes(doc.mimeType);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
