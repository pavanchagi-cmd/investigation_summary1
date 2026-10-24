import { NextResponse } from "next/server";
import { z } from "zod";
import { getCaseForUser, requireRole } from "@/lib/auth/guard";
import { idParam, parseBody, route } from "@/lib/http";
import { unlock } from "@/lib/narrative/service";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });

export const POST = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst", "admin"]);
  const c = await getCaseForUser(idParam((await params).id), user);
  const { reason } = await parseBody(req, Body);
  await unlock(c, user, reason);
  return NextResponse.json({ ok: true });
});
