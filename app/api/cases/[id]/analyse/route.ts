import { NextResponse } from "next/server";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { idParam, route } from "@/lib/http";
import { runAnalysis } from "@/lib/analysis/run";

type Ctx = { params: Promise<{ id: string }> };

/** Runs the deterministic scenario rules and counterparty ranking. */
export const POST = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  return NextResponse.json(await runAnalysis(c.id, user.id));
});
