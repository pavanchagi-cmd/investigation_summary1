"use client";

import * as React from "react";
import type { AuditRow } from "@/lib/audit/queries";

/** Full audit log with an option to show AI-call events (model, prompt version, input hash, latency, tokens). */
export function AuditTable({ events }: { events: AuditRow[] }) {
  const [showAi, setShowAi] = React.useState(false);
  const [open, setOpen] = React.useState<number | null>(null);
  const rows = events.filter((e) => showAi || e.action !== "ai_call");
  return (
    <div>
      <label className="mb-3 inline-flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={showAi} onChange={(e) => setShowAi(e.target.checked)} className="accent-[#1F4FD1]" />
        Show AI calls
      </label>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-page text-[12px] text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Time (UTC)</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <React.Fragment key={e.id}>
                <tr className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px]">{e.at.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-3 py-2">{e.text}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-muted">{e.action}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-[12.5px] text-accent underline" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                      {open === e.id ? "Hide" : "Before / after"}
                    </button>
                  </td>
                </tr>
                {open === e.id ? (
                  <tr className="bg-page">
                    <td colSpan={4} className="px-3 py-2">
                      <div className="grid gap-3 md:grid-cols-2">
                        <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11.5px]">before: {JSON.stringify(e.before, null, 2)}</pre>
                        <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11.5px]">after: {JSON.stringify(e.after, null, 2)}</pre>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
