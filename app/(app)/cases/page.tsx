import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireRole, ALL_ROLES } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { cases, users } from "@/lib/db/schema";
import { formatDuration } from "@/lib/format";

export const metadata = { title: "My cases · TM Summary Drafter" };

export default async function CasesPage() {
  const user = await requireRole(ALL_ROLES);
  const db = await getDb();
  const base = db
    .select({
      id: cases.id,
      alertNumber: cases.alertNumber,
      status: cases.status,
      startedAt: cases.startedAt,
      timeToDraftSeconds: cases.timeToDraftSeconds,
      disposition: cases.disposition,
      analyst: users.name,
    })
    .from(cases)
    .innerJoin(users, eq(users.id, cases.createdBy))
    .orderBy(desc(cases.startedAt))
    .limit(200);
  const rows =
    user.role === "analyst"
      ? await base.where(and(eq(cases.createdBy, user.id), eq(cases.syntheticHistory, false)))
      : await base.where(eq(cases.syntheticHistory, false));

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[24px] font-semibold">{user.role === "analyst" ? "My cases" : "All cases"}</h1>
        {user.role === "analyst" ? (
          <Button asChild variant="primary">
            <Link href="/cases/new">
              <Plus /> New investigation summary
            </Link>
          </Button>
        ) : null}
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead className="bg-page text-[12.5px] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Alert</th>
              <th className="px-4 py-3 font-medium">Analyst</th>
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Time-to-draft</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  No cases yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono">
                    <Link
                      className="text-accent underline-offset-2 hover:underline"
                      href={user.role === "analyst" ? `/cases/${r.id}/intake` : `/cases/${r.id}/review`}
                    >
                      {r.alertNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.analyst}</td>
                  <td className="px-4 py-3 font-mono text-[13px]">{r.startedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3">{r.status === "approved" ? "Approved" : "Drafting"}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {r.timeToDraftSeconds != null ? formatDuration(r.timeToDraftSeconds) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
