import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_ROLES, getCaseForUser, getEditableCase, requireRole } from "@/lib/auth/guard";
import { idParam, parseBody, route } from "@/lib/http";
import { excludeAll, excludeIssue, fixIssue, listIssues } from "@/lib/documents/issues";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(idParam((await params).id), user);
  return NextResponse.json({ issues: await listIssues(c.id) });
});

const reason = z.string().trim().min(3, "Give a reason").max(500);
const Patch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fix"), issueId: z.number().int().positive(), values: z.record(z.string(), z.string().max(500)) }),
  z.object({ action: z.literal("exclude"), issueId: z.number().int().positive(), reason }),
  z.object({ action: z.literal("exclude_all"), documentId: z.number().int().positive(), reason }),
]);

export const PATCH = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const body = await parseBody(req, Patch);
  if (body.action === "fix") return NextResponse.json(await fixIssue(c.id, user, body.issueId, body.values));
  if (body.action === "exclude") await excludeIssue(c.id, user, body.issueId, body.reason);
  else await excludeAll(c.id, user, body.documentId, body.reason);
  return NextResponse.json({ ok: true });
});
