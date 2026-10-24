import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ALL_ROLES, getCaseForUser, getEditableCase, requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { cases, scenarioEnum, dispositionEnum } from "@/lib/db/schema";
import { idParam, parseBody, route } from "@/lib/http";
import { addSubAlert, listSubAlerts, removeSubAlert, setReviewPeriod, updateSubAlert } from "@/lib/cases/service";
import { logAudit } from "@/lib/audit/log";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, { params }: Ctx) => {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(idParam((await params).id), user);
  return NextResponse.json({ case: c, subAlerts: await listSubAlerts(c.id) });
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const Patch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_review_period"), start: isoDate, end: isoDate }),
  z.object({ action: z.literal("add_sub_alert") }),
  z.object({
    action: z.literal("update_sub_alert"),
    id: z.number().int().positive(),
    patch: z
      .object({
        subAlertNumber: z.string().min(1).max(64),
        scenario: z.enum(scenarioEnum.enumValues).nullable(),
        ruleId: z.string().max(64).nullable(),
        threshold: z.string().max(200).nullable(),
        triggerDetails: z.string().max(500).nullable(),
        triggeringTxnCount: z.number().int().min(0).nullable(),
      })
      .partial(),
  }),
  z.object({ action: z.literal("remove_sub_alert"), id: z.number().int().positive() }),
  z.object({
    action: z.literal("set_disposition"),
    disposition: z.enum(dispositionEnum.enumValues).nullable(),
    rationale: z.string().max(5000),
  }),
]);

export const PATCH = route(async (req, { params }: Ctx) => {
  const user = await requireRole(["analyst"]);
  const c = await getEditableCase(idParam((await params).id), user);
  const body = await parseBody(req, Patch);
  switch (body.action) {
    case "set_review_period":
      await setReviewPeriod(c.id, user, body.start, body.end);
      break;
    case "add_sub_alert":
      return NextResponse.json({ subAlert: await addSubAlert(c.id, user) });
    case "update_sub_alert":
      return NextResponse.json({ subAlert: await updateSubAlert(c.id, user, body.id, body.patch) });
    case "remove_sub_alert":
      await removeSubAlert(c.id, user, body.id);
      break;
    case "set_disposition": {
      const db = await getDb();
      await db.update(cases).set({ disposition: body.disposition, rationale: body.rationale }).where(eq(cases.id, c.id));
      await logAudit({
        caseId: c.id,
        actorId: user.id,
        action: "disposition_set",
        entity: "case",
        entityId: c.id,
        before: { disposition: c.disposition, rationale: c.rationale },
        after: { disposition: body.disposition, rationale: body.rationale },
      });
      break;
    }
  }
  return NextResponse.json({ ok: true });
});
