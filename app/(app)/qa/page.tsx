import Link from "next/link";
import { desc, eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ALL_ROLES, requireRole } from "@/lib/auth/guard";
import { getDb } from "@/lib/db";
import { cases, users } from "@/lib/db/schema";
import { DISPOSITION_LABEL } from "@/lib/export/model";
import { formatDuration } from "@/lib/format";

export const metadata = { title: "QA review · TM Summary Drafter" };

export default async function QaPage() {
  const user = await requireRole(ALL_ROLES);
  if (user.role === "analyst") redirect("/cases");
  const db = await getDb();
  const rows = await db
    .select({ c: cases, analyst: users.name })
    .from(cases)
    .innerJoin(users, eq(users.id, cases.createdBy))
    .where(and(eq(cases.status, "approved"), eq(cases.syntheticHistory, false)))
    .orderBy(desc(cases.approvedAt))
    .limit(200);
  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-10">
      <h1 className="text-[24px] font-semibold">QA review</h1>
      <p className="mt-1 text-[14px] text-muted">Approved narratives, read-only, with the original AI draft, diff, edit history and audit log.</p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-left text-[14px]">
          <thead className="bg-page text-[12.5px] text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Alert</th>
              <th className="px-4 py-3 font-medium">Analyst</th>
              <th className="px-4 py-3 font-medium">Approved</th>
              <th className="px-4 py-3 font-medium">Disposition</th>
              <th className="px-4 py-3 text-right font-medium">Time-to-draft</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  No approved cases yet.
                </td>
              </tr>
            ) : (
              rows.map(({ c, analyst }) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-4 py-3 font-mono">
                    <Link className="text-accent underline-offset-2 hover:underline" href={`/cases/${c.id}/review`}>
                      {c.alertNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{analyst}</td>
                  <td className="px-4 py-3 font-mono text-[13px]">{c.approvedAt?.toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="px-4 py-3">{c.disposition ? DISPOSITION_LABEL[c.disposition] : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{c.timeToDraftSeconds != null ? formatDuration(c.timeToDraftSeconds) : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
