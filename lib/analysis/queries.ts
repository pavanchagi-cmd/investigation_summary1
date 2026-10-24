import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { counterparties, relationshipSummaries, scenarioFindings, transactions, users, type Counterparty } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit/log";
import { HttpError } from "@/lib/http";
import { maskAccount } from "@/lib/mask";
import type { SessionUser } from "@/lib/auth/guard";

export type CounterpartyView = Omit<Counterparty, "account"> & { account: string | null };

export async function listCounterparties(caseId: number, fullAccounts: boolean): Promise<CounterpartyView[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(counterparties)
    .where(and(eq(counterparties.caseId, caseId), eq(counterparties.stale, false)))
    .orderBy(asc(counterparties.rank));
  return rows.map((r) => ({ ...r, account: fullAccounts ? r.account : maskAccount(r.account) }));
}

/** Swap: the chosen top-6 row is replaced by another ranked counterparty; reason required; always 6. */
export async function swapCounterparty(caseId: number, user: SessionUser, outId: number, inId: number, reason: string) {
  const db = await getDb();
  const rows = await db.select().from(counterparties).where(and(eq(counterparties.caseId, caseId), eq(counterparties.stale, false)));
  const out = rows.find((r) => r.id === outId);
  const inn = rows.find((r) => r.id === inId);
  if (!out || !inn) throw new HttpError(404, "Counterparty not found");
  if (!out.inTop6) throw new HttpError(400, "Only a top-6 counterparty can be swapped out");
  if (inn.inTop6) throw new HttpError(400, "That counterparty is already in the top 6");
  await db.update(counterparties).set({ inTop6: false }).where(eq(counterparties.id, out.id));
  // If `out` was itself swapped in, the new row takes over the original replaced key.
  await db
    .update(counterparties)
    .set({ inTop6: true, swappedReason: reason, swappedFor: out.swappedFor ?? out.key })
    .where(eq(counterparties.id, inn.id));
  if (out.swappedFor) await db.update(counterparties).set({ swappedFor: null, swappedReason: null }).where(eq(counterparties.id, out.id));
  await logAudit({
    caseId,
    actorId: user.id,
    action: "counterparty_swapped",
    entity: "counterparty",
    entityId: inn.id,
    before: { top6: out.name, rank: out.rank },
    after: { top6: inn.name, rank: inn.rank, reason },
  });
}

export async function listFindings(caseId: number) {
  const db = await getDb();
  const rows = await db
    .select({ f: scenarioFindings, dismissedByName: users.name })
    .from(scenarioFindings)
    .leftJoin(users, eq(users.id, scenarioFindings.dismissedBy))
    .where(eq(scenarioFindings.caseId, caseId));
  const ids = [...new Set(rows.flatMap((r) => r.f.matchedTxnIds))];
  const txns = ids.length
    ? await db
        .select({ id: transactions.id, date: transactions.date, transactionId: transactions.transactionId, amount: transactions.amountBaseCcy })
        .from(transactions)
        .where(and(eq(transactions.caseId, caseId), inArray(transactions.id, ids)))
    : [];
  const byId = new Map(txns.map((t) => [t.id, t]));
  return rows.map(({ f, dismissedByName }) => ({
    ...f,
    dismissedByName,
    preview: f.matchedTxnIds
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
      .slice(0, 3),
  }));
}
export type FindingView = Awaited<ReturnType<typeof listFindings>>[number];

export async function setFindingDismissed(user: SessionUser, findingId: number, caseId: number, dismissed: boolean, reason: string | null) {
  const db = await getDb();
  const [f] = await db.select().from(scenarioFindings).where(and(eq(scenarioFindings.id, findingId), eq(scenarioFindings.caseId, caseId)));
  if (!f) throw new HttpError(404, "Finding not found");
  await db
    .update(scenarioFindings)
    .set(dismissed ? { dismissed: true, dismissReason: reason, dismissedBy: user.id } : { dismissed: false, dismissReason: null, dismissedBy: null })
    .where(eq(scenarioFindings.id, findingId));
  await logAudit({
    caseId,
    actorId: user.id,
    action: dismissed ? "flag_dismissed" : "flag_restored",
    entity: "scenario_finding",
    entityId: findingId,
    before: { dismissed: f.dismissed, reason: f.dismissReason },
    after: { scenario: f.scenario, dismissed, reason },
  });
}

export async function listSummaries(caseId: number) {
  const db = await getDb();
  return db.select().from(relationshipSummaries).where(eq(relationshipSummaries.caseId, caseId));
}
