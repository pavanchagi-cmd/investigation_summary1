import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { caseFields, cases } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit/log";
import { HttpError } from "@/lib/http";
import { maskAccount } from "@/lib/mask";
import type { SessionUser } from "@/lib/auth/guard";

export type FieldView = {
  id: number;
  question: "q1" | "q2" | "q3" | "q4" | "q5";
  fieldKey: string;
  aiValue: unknown;
  analystValue: unknown;
  value: unknown;
  sourceRef: string | null;
  confidence: number | null;
  status: "ai" | "edited" | "confirmed";
};

type Accounts = { account_number: string; opened_date: string | null }[];

/** Masks account numbers in field values unless the viewer has view_full_account. */
function maskValue(fieldKey: string, v: unknown, full: boolean): unknown {
  if (full || v == null) return v;
  if (fieldKey === "accounts" && Array.isArray(v)) {
    return (v as Accounts).map((a) => ({ ...a, account_number: maskAccount(a.account_number) ?? "" }));
  }
  return v;
}

export async function getFields(caseId: number, fullAccounts: boolean): Promise<FieldView[]> {
  const db = await getDb();
  const rows = await db.select().from(caseFields).where(eq(caseFields.caseId, caseId));
  return rows.map((r) => {
    const value = r.analystValue ?? r.aiValue;
    return {
      id: r.id,
      question: r.question,
      fieldKey: r.fieldKey,
      aiValue: maskValue(r.fieldKey, r.aiValue, fullAccounts),
      analystValue: maskValue(r.fieldKey, r.analystValue, fullAccounts),
      value: maskValue(r.fieldKey, value, fullAccounts),
      sourceRef: r.sourceRef,
      confidence: r.confidence,
      status: r.status,
    };
  });
}

/** Analyst edit or confirm of a Q1–Q3 field. ai_value is never touched. */
export async function editField(
  caseId: number,
  user: SessionUser,
  input: { question: "q1" | "q3"; fieldKey: string; value?: unknown; confirm?: boolean },
) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(caseFields)
    .where(and(eq(caseFields.caseId, caseId), eq(caseFields.question, input.question), eq(caseFields.fieldKey, input.fieldKey)));
  if (!row && input.confirm) throw new HttpError(404, "Field not found");
  const before = row ? { value: row.analystValue ?? row.aiValue, status: row.status } : null;
  let after: { value: unknown; status: "edited" | "confirmed" };
  if (input.confirm) {
    after = { value: row!.analystValue ?? row!.aiValue, status: "confirmed" };
    await db.update(caseFields).set({ status: "confirmed" }).where(eq(caseFields.id, row!.id));
  } else {
    const value = typeof input.value === "string" ? input.value.trim() || null : (input.value ?? null);
    after = { value, status: "edited" };
    if (row) await db.update(caseFields).set({ analystValue: value, status: "edited" }).where(eq(caseFields.id, row.id));
    else
      await db.insert(caseFields).values({
        caseId,
        question: input.question,
        fieldKey: input.fieldKey,
        analystValue: value,
        status: "edited",
      });
  }
  await db.update(cases).set({ needsAnalysis: true }).where(eq(cases.id, caseId));
  await logAudit({
    caseId,
    actorId: user.id,
    action: "field_edited",
    entity: "case_field",
    entityId: `${input.question}.${input.fieldKey}`,
    before,
    after: { question: input.question, field: input.fieldKey, ...after },
  });
}
