import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { relationshipSummaries } from "@/lib/db/schema";
import { HttpError, idParam, parseBody, route } from "@/lib/http";
import { updateSummary } from "@/lib/q5/service";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z
  .object({
    analystText: z.string().max(2000).optional(),
    reviewStatus: z.enum(["agree", "edited", "needs_rfi"]).optional(),
  })
  .refine((b) => b.analystText !== undefined || b.reviewStatus !== undefined, "Nothing to change");

export const PATCH = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const id = idParam((await params).id);
  const db = await getDb();
  const [row] = await db.select().from(relationshipSummaries).where(eq(relationshipSummaries.id, id));
  if (!row) throw new HttpError(404, "Summary not found");
  await getEditableCase(row.caseId, user);
  await updateSummary(row.caseId, user, id, await parseBody(req, Patch));
  return NextResponse.json({ ok: true });
});
