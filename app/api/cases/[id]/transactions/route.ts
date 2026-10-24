import { NextResponse } from "next/server";
import { z } from "zod";
import { canViewFullAccount, getCaseForUser, requireRole } from "@/lib/auth/guard";
import { idParam, route } from "@/lib/http";
import { queryTransactions } from "@/lib/cases/transactions";

type Ctx = { params: Promise<{ id: string }> };

const Query = z.object({
  inPeriod: z.enum(["true", "false"]).optional(),
  ids: z.string().regex(/^\d+(,\d+)*$/).optional(),
  direction: z.enum(["incoming", "outgoing"]).optional(),
  documentId: z.coerce.number().int().positive().optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
});

export const GET = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst", "qa", "admin"]);
  const c = await getCaseForUser(idParam((await params).id), user);
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const result = await queryTransactions(
    c.id,
    {
      inPeriod: q.inPeriod === undefined ? undefined : q.inPeriod === "true",
      ids: q.ids?.split(",").map(Number),
      direction: q.direction,
      documentId: q.documentId,
      q: q.q,
      page: q.page,
      pageSize: q.pageSize,
    },
    canViewFullAccount(user),
  );
  return NextResponse.json(result);
});
