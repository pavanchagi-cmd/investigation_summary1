import { NextResponse } from "next/server";
import { getCaseForUser, requireRole } from "@/lib/auth/guard";
import { idParam, route } from "@/lib/http";
import { recordHeartbeat } from "@/lib/cases/service";

type Ctx = { params: Promise<{ id: string }> };

/** Active-time tracking: the client only sends beats while the analyst is active (spec section 11). */
export const POST = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getCaseForUser(idParam((await params).id), user);
  const activeSeconds = await recordHeartbeat(c.id);
  return NextResponse.json({ activeSeconds });
});
