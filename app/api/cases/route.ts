import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ALL_ROLES, requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { cases } from "@/lib/db/schema";
import { parseBody, route } from "@/lib/http";
import { createCase } from "@/lib/cases/service";

export const GET = route(async () => {
  const user = await requireRole(ALL_ROLES);
  const db = await getDb();
  const q = db.select().from(cases).orderBy(desc(cases.startedAt)).limit(500);
  const rows = user.role === "analyst" ? await q.where(eq(cases.createdBy, user.id)) : await q;
  return NextResponse.json({ cases: rows });
});

const CreateCase = z.object({ alertNumber: z.string().min(1).max(64) });

export const POST = route(async (req) => {
  const user = await requireRole(["analyst"]);
  const { alertNumber } = await parseBody(req, CreateCase);
  const { case: c, created } = await createCase(user, alertNumber);
  return NextResponse.json({ id: c.id, created }, { status: created ? 201 : 200 });
});
