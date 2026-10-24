import { NextResponse } from "next/server";
import { getCaseForUser, requireRole } from "@/lib/auth/guard";
import { idParam, route } from "@/lib/http";
import { approve } from "@/lib/narrative/service";

type Ctx = { params: Promise<{ id: string }> };

/** Explicit analyst action: approve the narrative with the chosen disposition (never automatic). */
export const POST = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(["analyst", "admin"]);
  const c = await getCaseForUser(idParam((await params).id), user);
  await approve(c, user);
  return NextResponse.json({ ok: true });
});
