import { ALL_ROLES, requireRole } from "@/lib/auth/guard";
import { getDashboard, type Period } from "@/lib/dashboard/metrics";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata = { title: "Dashboard · TM Summary Drafter" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string; analyst?: string }> }) {
  const user = await requireRole(ALL_ROLES);
  const sp = await searchParams;
  const period: Period = sp.period === "quarter" ? "quarter" : "8w";
  const analystId = sp.analyst && /^\d+$/.test(sp.analyst) ? Number(sp.analyst) : null;
  const data = await getDashboard(user, { period, analystId });
  return <DashboardView data={data} analystId={analystId} />;
}
