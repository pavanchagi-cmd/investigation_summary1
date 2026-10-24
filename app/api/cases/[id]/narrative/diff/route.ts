import { NextResponse } from "next/server";
import { getCaseForUser, requireRole } from "@/lib/auth/guard";
import { idParam, route } from "@/lib/http";
import { narrativeDiff } from "@/lib/narrative/service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(["analyst", "qa", "admin"]);
  const c = await getCaseForUser(idParam((await params).id), user);
  return NextResponse.json({ diff: await narrativeDiff(c.id) });
});
