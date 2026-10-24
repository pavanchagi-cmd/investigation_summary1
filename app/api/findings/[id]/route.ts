import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { scenarioFindings } from "@/lib/db/schema";
import { HttpError, idParam, parseBody, route } from "@/lib/http";
import { setFindingDismissed } from "@/lib/analysis/queries";

type Ctx = { params: Promise<{ id: string }> };

const Patch = z.discriminatedUnion("dismissed", [
  z.object({ dismissed: z.literal(true), reason: z.string().trim().min(3, "A reason is required").max(500) }),
  z.object({ dismissed: z.literal(false) }),
]);

export const PATCH = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const id = idParam((await params).id);
  const db = await getDb();
  const [f] = await db.select().from(scenarioFindings).where(eq(scenarioFindings.id, id));
  if (!f) throw new HttpError(404, "Finding not found");
  await getEditableCase(f.caseId, user);
  const body = await parseBody(req, Patch);
  await setFindingDismissed(user, id, f.caseId, body.dismissed, body.dismissed ? body.reason : null);
  return NextResponse.json({ ok: true });
});
