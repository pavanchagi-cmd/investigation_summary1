import "server-only";
import type { Case } from "@/lib/db/schema";
import { runAnalysis } from "@/lib/analysis/run";

/** Screens 2–4 show current results: re-run the deterministic analysis when inputs changed. */
export async function ensureAnalysis(c: Case, actorId: number): Promise<void> {
  if (c.status !== "drafting" || !c.needsAnalysis) return;
  await runAnalysis(c.id, actorId);
}
