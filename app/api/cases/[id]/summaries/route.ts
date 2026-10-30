import { NextResponse } from "next/server";
import { z } from "zod";
import { getEditableCase, requireRole } from "@/lib/auth/guard";
import { idParam, route } from "@/lib/http";
import { generateSummaries } from "@/lib/q5/service";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

const Body = z.object({ all: z.boolean().optional() }).default({});

/** Gemini call 3: Q5 relationship summaries for the top 6. */
export const POST = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const body = Body.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await generateSummaries(c.id, user, body));
});
