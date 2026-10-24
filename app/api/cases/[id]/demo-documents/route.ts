import { NextResponse } from "next/server";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { HttpError, idParam, route } from "@/lib/http";
import { attachDemoDocuments, demoSetFor } from "@/lib/documents/demo";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

/** Attaches the synthetic demo document set for one of the four demo alert numbers. */
export const POST = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  if (!(await demoSetFor(c.alertNumber)).length) throw new HttpError(404, "No demo documents for this alert number");
  const ids = await attachDemoDocuments(c.id, c.alertNumber, user);
  return NextResponse.json({ ids }, { status: 201 });
});
