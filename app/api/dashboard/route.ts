import { NextResponse } from "next/server";
import { z } from "zod";
import { ALL_ROLES, requireRole } from "@/lib/auth/guard";
import { route } from "@/lib/http";
import { getDashboard } from "@/lib/dashboard/metrics";

const Query = z.object({ period: z.enum(["8w", "quarter"]).default("8w"), analyst: z.coerce.number().int().positive().optional() });

export const GET = route(async (req) => {
  const user = await requireRole(ALL_ROLES);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await getDashboard(user, { period: q.period, analystId: q.analyst ?? null }));
});
