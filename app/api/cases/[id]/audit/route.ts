import { NextResponse } from "next/server";
import { ALL_ROLES, getCaseForUser, requireRole } from "@/lib/auth/guard";
import { idParam, route } from "@/lib/http";
import { caseAudit } from "@/lib/audit/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(idParam((await params).id), user);
  return NextResponse.json({ events: await caseAudit(c.id, 2000, { includeAi: true }) });
});
