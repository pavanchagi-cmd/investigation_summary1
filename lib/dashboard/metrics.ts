import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cases, subAlerts, users } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import type { SessionUser } from "@/lib/auth/guard";

export type Period = "8w" | "quarter";

const SHORT: Record<string, string> = { large_amount: "LA", pattern_of_funds: "PF", round_dollar: "RD", wire_structuring: "WS" };
const DAY = 86_400_000;

function periodStart(period: Period, now: Date) {
  if (period === "quarter") return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  return new Date(now.getTime() - 56 * DAY);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Dashboard metrics read only approved cases; the recent-cases table also lists cases in progress. */
export async function getDashboard(viewer: SessionUser, opts: { period: Period; analystId?: number | null }) {
  const db = await getDb();
  const cfg = await getConfig();
  const now = new Date();
  const from = periodStart(opts.period, now);
  const analystFilter = opts.analystId ? [eq(cases.createdBy, opts.analystId)] : [];

  const approved = await db
    .select()
    .from(cases)
    .where(and(eq(cases.status, "approved"), gte(cases.approvedAt, from), ...analystFilter));

  const active = approved.map((c) => c.activeSeconds / 60);
  const wall = approved.filter((c) => c.timeToDraftSeconds != null).map((c) => c.timeToDraftSeconds! / 60);
  const kept = approved.filter((c) => c.pctAiKept != null).map((c) => c.pctAiKept!);
  const avgActive = avg(active);
  const baseline = cfg.manual_baseline_minutes;

  // Weekly average (active) minutes per case, last 8 weeks, oldest first.
  const weekStart = (d: Date) => {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); // Monday
    return x;
  };
  const thisWeek = weekStart(now);
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const start = new Date(thisWeek.getTime() - (7 - i) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const inWeek = approved.filter((c) => c.approvedAt! >= start && c.approvedAt! < end);
    const a = avg(inWeek.map((c) => c.activeSeconds / 60));
    return { label: `W${i + 1}`, start: start.toISOString().slice(0, 10), minutes: a == null ? null : Math.round(a), cases: inWeek.length };
  });

  const dispositions = {
    escalate_sar: approved.filter((c) => c.disposition === "escalate_sar").length,
    close_nfa: approved.filter((c) => c.disposition === "close_nfa").length,
    request_info: approved.filter((c) => c.disposition === "request_info").length,
  };

  // Recent cases (analysts see their own rows only).
  const ownOnly = viewer.role === "analyst" ? [eq(cases.createdBy, viewer.id)] : [];
  const recent = await db
    .select({ c: cases, analyst: users.name })
    .from(cases)
    .innerJoin(users, eq(users.id, cases.createdBy))
    .where(and(...ownOnly, ...analystFilter))
    .orderBy(desc(cases.startedAt))
    .limit(20);
  const subs = recent.length
    ? await db.select({ caseId: subAlerts.caseId, scenario: subAlerts.scenario }).from(subAlerts).where(inArray(subAlerts.caseId, recent.map((r) => r.c.id)))
    : [];

  const analysts = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "analyst"));

  return {
    period: opts.period,
    from: from.toISOString().slice(0, 10),
    casesDrafted: approved.length,
    avgActiveMinutes: avgActive == null ? null : Math.round(avgActive),
    avgWallMinutes: avg(wall) == null ? null : Math.round(avg(wall)!),
    baselineMinutes: baseline,
    timeSavedMinutes: baseline != null && avgActive != null ? Math.round(baseline - avgActive) : null,
    avgPctKept: avg(kept) == null ? null : Math.round(avg(kept)!),
    weeks,
    dispositions,
    analysts,
    recent: recent.map(({ c, analyst }) => ({
      id: c.id,
      alertNumber: c.alertNumber,
      scenarios: [...new Set(subs.filter((s) => s.caseId === c.id && s.scenario).map((s) => SHORT[s.scenario!]))].join(" · ") || "—",
      analyst,
      status: c.status,
      seconds: c.status === "approved" ? c.timeToDraftSeconds : Math.round((now.getTime() - c.startedAt.getTime()) / 1000),
      pctKept: c.pctAiKept,
      disposition: c.disposition,
      synthetic: c.syntheticHistory,
    })),
  };
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
