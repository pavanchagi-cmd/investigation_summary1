"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Select } from "@/components/ui/form";
import type { Dashboard } from "@/lib/dashboard/metrics";
import { formatDuration } from "@/lib/format";

// Past weeks in a lighter step of the accent ramp, current week in the accent (validated; values are labelled).
const PAST = "#7D98E8";
const CURRENT = "#1F4FD1";

const DISP = [
  { key: "escalate_sar", label: "Escalate to SAR/STR review" },
  { key: "close_nfa", label: "Close – no further action" },
  { key: "request_info", label: "Request more information" },
] as const;

const DISP_SHORT: Record<string, string> = { escalate_sar: "Escalate", close_nfa: "Close", request_info: "Request info" };

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="mt-3 font-mono text-[32px] leading-none text-ink">{value}</div>
      {sub ? <div className="mt-3 text-[12px] text-muted">{sub}</div> : null}
    </div>
  );
}

export function DashboardView({ data, analystId }: { data: Dashboard; analystId: number | null }) {
  const router = useRouter();
  const [table, setTable] = React.useState(false);
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams();
    p.set("period", k === "period" ? v : data.period);
    const a = k === "analyst" ? v : analystId ? String(analystId) : "";
    if (a) p.set("analyst", a);
    router.push(`/dashboard?${p}`);
  };
  const maxDisp = Math.max(1, ...Object.values(data.dispositions));
  const chartData = data.weeks.map((w, i) => ({ ...w, current: i === data.weeks.length - 1 }));
  const hasWeeks = chartData.some((w) => w.minutes != null);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 md:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-semibold">Time-to-draft</h1>
          <p className="mt-1 text-[13px] text-muted">Measured from alert number entry to narrative approval · approved cases since {data.from}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Filters">
          <label htmlFor="period" className="text-[13px] text-muted">
            Period
          </label>
          <Select id="period" className="w-[160px]" value={data.period} onChange={(e) => setParam("period", e.target.value)}>
            <option value="8w">Last 8 weeks</option>
            <option value="quarter">This quarter</option>
          </Select>
          <label htmlFor="analyst" className="text-[13px] text-muted">
            Analyst
          </label>
          <Select id="analyst" className="w-[180px]" value={analystId ? String(analystId) : ""} onChange={(e) => setParam("analyst", e.target.value)}>
            <option value="">All analysts</option>
            {data.analysts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Cases drafted" value={data.casesDrafted} />
        <Kpi
          label="Avg time-to-draft (tool, active)"
          value={data.avgActiveMinutes == null ? "—" : `${data.avgActiveMinutes} min`}
          sub={data.avgWallMinutes == null ? undefined : `Wall-clock ${data.avgWallMinutes} min`}
        />
        <Kpi
          label="Manual baseline"
          value={data.baselineMinutes == null ? "Not set" : `${data.baselineMinutes} min`}
          sub={
            data.timeSavedMinutes != null
              ? `Time saved ${data.timeSavedMinutes} min per case`
              : data.baselineMinutes == null
                ? "Set from a pre-tool time study (Admin)"
                : undefined
          }
        />
        <Kpi label="AI draft kept unchanged" value={data.avgPctKept == null ? "—" : `${data.avgPctKept}%`} sub="Share of words, by diff" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="weekly-title" className="min-w-0 rounded-xl border border-line bg-surface p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="weekly-title" className="text-[16px] font-semibold">
              Average minutes per case, by week
            </h2>
            <button type="button" className="text-[13px] text-accent underline" onClick={() => setTable((t) => !t)} aria-pressed={table}>
              {table ? "Show chart" : "Show table"}
            </button>
          </div>
          {table || !hasWeeks ? (
            <table className="mt-4 w-full text-left text-[13px]">
              <thead className="text-muted">
                <tr>
                  <th className="py-1.5 font-medium">Week</th>
                  <th className="py-1.5 font-medium">Starting</th>
                  <th className="py-1.5 text-right font-medium">Cases</th>
                  <th className="py-1.5 text-right font-medium">Avg minutes (active)</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map((w) => (
                  <tr key={w.label} className="border-t border-line font-mono">
                    <td className="py-1.5">{w.label}</td>
                    <td className="py-1.5">{w.start}</td>
                    <td className="py-1.5 text-right">{w.cases}</td>
                    <td className="py-1.5 text-right">{w.minutes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="mt-4 h-[260px]" role="img" aria-label={`Bar chart: ${chartData.map((w) => `${w.label} ${w.minutes ?? "no cases"}`).join(", ")} minutes`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 24, right: 8, left: 0, bottom: 0 }} barCategoryGap="12%">
                  <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#D9DEE5" }} tick={{ fill: "#4A5565", fontSize: 12, fontFamily: "var(--font-plex-mono)" }} />
                  <YAxis hide domain={[0, "dataMax"]} />
                  <Tooltip
                    cursor={{ fill: "#E8EEFC" }}
                    formatter={(v) => [`${v} min`, "Avg active time"]}
                    labelFormatter={(l, p) => `${l} · week of ${p?.[0]?.payload?.start ?? ""} · ${p?.[0]?.payload?.cases ?? 0} cases`}
                    contentStyle={{ borderRadius: 8, borderColor: "#D9DEE5", fontSize: 12 }}
                  />
                  <Bar dataKey="minutes" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {chartData.map((w) => (
                      <Cell key={w.label} fill={w.current ? CURRENT : PAST} />
                    ))}
                    <LabelList dataKey="minutes" position="top" style={{ fill: "#16202B", fontSize: 12 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section aria-labelledby="disp-title" className="rounded-xl border border-line bg-surface p-6">
          <h2 id="disp-title" className="text-[16px] font-semibold">
            Dispositions
          </h2>
          <ul className="mt-4 space-y-4">
            {DISP.map((d) => {
              const n = data.dispositions[d.key];
              return (
                <li key={d.key}>
                  <div className="flex justify-between text-[14px]">
                    <span>{d.label}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-page" aria-hidden>
                    <div className="h-2 rounded-full bg-accent" style={{ width: `${(n / maxDisp) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section aria-labelledby="recent-title" className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
        <h2 id="recent-title" className="px-6 py-5 text-[16px] font-semibold">
          Recent cases
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[14px]">
            <thead className="bg-page text-[12.5px] text-muted">
              <tr>
                <th className="px-6 py-3 font-medium">Alert</th>
                <th className="px-4 py-3 font-medium">Scenarios</th>
                <th className="px-4 py-3 font-medium">Analyst</th>
                <th className="px-4 py-3 text-right font-medium">Time-to-draft</th>
                <th className="px-4 py-3 text-right font-medium">AI text kept</th>
                <th className="px-6 py-3 font-medium">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-6 py-3 font-mono">
                    {r.synthetic ? (
                      <span title="Synthetic dashboard history">{r.alertNumber}</span>
                    ) : (
                      <Link className="text-accent underline-offset-2 hover:underline" href={`/cases/${r.id}/review`}>
                        {r.alertNumber}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.scenarios}</td>
                  <td className="px-4 py-3">{r.analyst}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.seconds != null ? formatDuration(r.seconds) : "—"}</td>
                  <td className="px-4 py-3 text-right font-mono">{r.pctKept != null ? `${Math.round(r.pctKept)}%` : "—"}</td>
                  <td className="px-6 py-3">{r.status === "approved" ? (DISP_SHORT[r.disposition ?? ""] ?? "—") : "In progress"}</td>
                </tr>
              ))}
              {data.recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted">
                    No cases yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
