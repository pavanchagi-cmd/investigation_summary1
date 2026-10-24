import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_ROLES, canViewFullAccount, getCaseForUser, getEditableCase, requireRole } from "@/lib/auth/guard";
import { idParam, parseBody, route } from "@/lib/http";
import { listCounterparties, swapCounterparty } from "@/lib/analysis/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(idParam((await params).id), user);
  return NextResponse.json({ counterparties: await listCounterparties(c.id, canViewFullAccount(user)) });
});

const Swap = z.object({
  outId: z.number().int().positive(),
  inId: z.number().int().positive(),
  reason: z.string().trim().min(3, "A reason is required for the audit log").max(500),
});

export const PATCH = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const body = await parseBody(req, Swap);
  await swapCounterparty(c.id, user, body.outId, body.inId, body.reason);
  return NextResponse.json({ ok: true });
});
