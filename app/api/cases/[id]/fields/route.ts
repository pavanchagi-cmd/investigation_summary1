import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_ROLES, canViewFullAccount, getCaseForUser, getEditableCase, requireRole } from "@/lib/auth/guard";
import { idParam, parseBody, route } from "@/lib/http";
import { editField, getFields } from "@/lib/cases/fields";
import { Q3_FIELDS } from "@/lib/parsing/prefill";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(idParam((await params).id), user);
  return NextResponse.json({ fields: await getFields(c.id, canViewFullAccount(user)) });
});

const Patch = z.union([
  z.object({ question: z.literal("q1"), fieldKey: z.enum(["alert_date"]), value: z.string().max(2000).nullable() }),
  z.object({ question: z.literal("q3"), fieldKey: z.enum(Q3_FIELDS), value: z.string().max(2000).nullable() }),
  z.object({ question: z.enum(["q1", "q3"]), fieldKey: z.string().max(64), confirm: z.literal(true) }),
]);

export const PATCH = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const body = await parseBody(req, Patch);
  await editField(c.id, user, body);
  return NextResponse.json({ ok: true });
});
