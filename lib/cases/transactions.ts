import "server-only";
import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { documents, transactions } from "@/lib/db/schema";
import { maskAccount } from "@/lib/mask";

export type TxnFilter = {
  inPeriod?: boolean;
  ids?: number[];
  direction?: "incoming" | "outgoing";
  documentId?: number;
  q?: string;
  page?: number;
  pageSize?: number;
};

/** Paged transaction list. Account numbers are masked unless the caller may see them in full. */
export async function queryTransactions(caseId: number, f: TxnFilter, fullAccounts: boolean) {
  const db = await getDb();
  const where: SQL[] = [eq(transactions.caseId, caseId)];
  if (f.inPeriod !== undefined) where.push(eq(transactions.inPeriod, f.inPeriod));
  if (f.ids?.length) where.push(inArray(transactions.id, f.ids));
  if (f.direction) where.push(eq(transactions.direction, f.direction));
  if (f.documentId) where.push(eq(transactions.documentId, f.documentId));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    where.push(or(ilike(transactions.counterpartyName, like), ilike(transactions.transactionId, like), ilike(transactions.referenceText, like))!);
  }
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 500);
  const page = Math.max(f.page ?? 1, 1);
  const [{ total }] = await db.select({ total: count() }).from(transactions).where(and(...where));
  const rows = await db
    .select({ t: transactions, fileName: documents.fileName })
    .from(transactions)
    .innerJoin(documents, eq(documents.id, transactions.documentId))
    .where(and(...where))
    .orderBy(asc(transactions.date), asc(transactions.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    total,
    page,
    pageSize,
    rows: rows.map(({ t, fileName }) => ({
      ...t,
      counterpartyAccount: fullAccounts ? t.counterpartyAccount : maskAccount(t.counterpartyAccount),
      source: `${fileName} · ${t.sourceRow}`,
    })),
  };
}
export type TxnRow = Awaited<ReturnType<typeof queryTransactions>>["rows"][number];

export async function periodStats(caseId: number) {
  const db = await getDb();
  const [r] = await db
    .select({
      inPeriod: sql<number>`count(*) filter (where ${transactions.inPeriod})::int`,
      excluded: sql<number>`count(*) filter (where not ${transactions.inPeriod})::int`,
      flow: sql<number>`coalesce(sum(${transactions.amountBaseCcy}) filter (where ${transactions.inPeriod}), 0)::float8`,
    })
    .from(transactions)
    .where(eq(transactions.caseId, caseId));
  return r ?? { inPeriod: 0, excluded: 0, flow: 0 };
}
