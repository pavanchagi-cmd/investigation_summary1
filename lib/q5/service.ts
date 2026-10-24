import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { relationshipSummaries } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit/log";
import { callGemini } from "@/lib/llm/gemini";
import { loadPrompt } from "@/lib/llm/prompts";
import { RelationshipSummaries } from "@/lib/llm/schemas";
import { HttpError } from "@/lib/http";
import type { SessionUser } from "@/lib/auth/guard";
import { buildQ5Input } from "./input";

/** Gemini call 3: one call drafts summaries for every top-6 counterparty that has none yet. */
export async function generateSummaries(caseId: number, user: SessionUser, opts: { all?: boolean } = {}) {
  const db = await getDb();
  const input = await buildQ5Input(caseId);
  const existing = await db.select().from(relationshipSummaries).where(eq(relationshipSummaries.caseId, caseId));
  const targets = input.counterparties.filter((c) => opts.all || !existing.some((e) => e.counterpartyId === c.counterpartyId));
  if (!targets.length) return { generated: 0 };
  const prompt = loadPrompt("q5-summaries");
  const payload = { ...input, counterparties: targets };
  const res = await callGemini({
    task: "q5_summaries",
    schema: RelationshipSummaries,
    systemInstruction: prompt.text,
    parts: [{ text: JSON.stringify(payload) }],
    promptVersion: prompt.version,
    caseId,
    actorId: user.id,
    mockInput: payload,
  });
  const ids = new Set(targets.map((t) => t.counterpartyId));
  let generated = 0;
  for (const s of res.data.summaries) {
    if (!ids.has(s.counterpartyId)) continue; // ignore anything the model invented
    const values = {
      relationshipType: s.relationshipType,
      relationshipSubtype: s.relationshipSubtype,
      purpose: s.purpose,
      kycFit: s.kycFit,
      aiText: s.summary,
      sources: s.sources,
    };
    const row = existing.find((e) => e.counterpartyId === s.counterpartyId);
    if (row) {
      await db.update(relationshipSummaries).set({ ...values, analystText: null, reviewStatus: null }).where(eq(relationshipSummaries.id, row.id));
    } else {
      await db.insert(relationshipSummaries).values({ caseId, counterpartyId: s.counterpartyId, ...values });
    }
    generated++;
  }
  await logAudit({ caseId, actorId: user.id, action: "q5_generated", entity: "relationship_summary", after: { count: generated, model: res.model, prompt_version: res.promptVersion } });
  return { generated };
}

export async function updateSummary(
  caseId: number,
  user: SessionUser,
  id: number,
  patch: { analystText?: string; reviewStatus?: "agree" | "edited" | "needs_rfi" },
) {
  const db = await getDb();
  const [row] = await db.select().from(relationshipSummaries).where(and(eq(relationshipSummaries.id, id), eq(relationshipSummaries.caseId, caseId)));
  if (!row) throw new HttpError(404, "Summary not found");
  const set: Partial<typeof relationshipSummaries.$inferInsert> = {};
  if (patch.analystText !== undefined) {
    set.analystText = patch.analystText;
    // Typing in the summary sets Edited automatically (spec section 6).
    set.reviewStatus = patch.reviewStatus ?? "edited";
  } else if (patch.reviewStatus) set.reviewStatus = patch.reviewStatus;
  await db.update(relationshipSummaries).set(set).where(eq(relationshipSummaries.id, id));
  await logAudit({
    caseId,
    actorId: user.id,
    action: patch.analystText !== undefined ? "q5_edited" : "q5_status_set",
    entity: "relationship_summary",
    entityId: id,
    before: { text: row.analystText ?? row.aiText, status: row.reviewStatus },
    after: { text: set.analystText ?? undefined, status: set.reviewStatus },
  });
}
