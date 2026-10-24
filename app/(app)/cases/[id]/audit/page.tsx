import Link from "next/link";
import { notFound } from "next/navigation";
import { ALL_ROLES, getCaseForUser, requireRole } from "@/lib/auth/guard";
import { caseAudit } from "@/lib/audit/queries";
import { AuditTable } from "@/components/review/audit-table";

export const metadata = { title: "Audit log · TM Summary Drafter" };

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(ALL_ROLES);
  const c = await getCaseForUser(Number((await params).id), user).catch(() => notFound());
  const events = await caseAudit(c.id, 2000, { includeAi: true });
  return (
    <section className="rounded-xl border border-line bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[18px] font-semibold">Full audit log</h2>
        <Link className="text-[13px] text-accent underline" href={user.role === "analyst" ? `/cases/${c.id}/narrative` : `/cases/${c.id}/review`}>
          Back to case
        </Link>
      </div>
      <AuditTable events={events} />
    </section>
  );
}
