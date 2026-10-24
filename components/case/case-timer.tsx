"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Timer } from "lucide-react";
import { formatDuration } from "@/lib/format";

const IDLE_AFTER_MS = 5 * 60 * 1000;
const BEAT_MS = 30 * 1000;

/**
 * Wall-clock time since the alert number was entered (server-persisted started_at) plus active
 * time, which only advances while the analyst is active (paused after 5 minutes idle).
 */
export function CaseTimer({
  caseId,
  startedAt,
  approvedAt,
  activeSeconds,
  canBeat,
}: {
  caseId: number;
  startedAt: string;
  approvedAt: string | null;
  activeSeconds: number;
  canBeat: boolean;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  const [active, setActive] = React.useState(activeSeconds);
  const [slot, setSlot] = React.useState<HTMLElement | null>(null);
  const lastInput = React.useRef(Date.now());

  React.useEffect(() => setSlot(document.getElementById("topbar-timer")), []);
  React.useEffect(() => setActive(activeSeconds), [activeSeconds]);

  React.useEffect(() => {
    if (approvedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [approvedAt]);

  React.useEffect(() => {
    if (!canBeat || approvedAt) return;
    const mark = () => (lastInput.current = Date.now());
    const events = ["mousemove", "keydown", "scroll", "click", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const beat = async () => {
      const isActive = document.visibilityState === "visible" && Date.now() - lastInput.current < IDLE_AFTER_MS;
      if (!isActive) return;
      try {
        const res = await fetch(`/api/cases/${caseId}/heartbeat`, { method: "POST" });
        if (res.ok) setActive(((await res.json()) as { activeSeconds: number }).activeSeconds);
      } catch {
        /* offline: the next beat catches up */
      }
    };
    void beat();
    const t = setInterval(beat, BEAT_MS);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [caseId, canBeat, approvedAt]);

  const end = approvedAt ? new Date(approvedAt).getTime() : now;
  const wall = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 1000));
  const content = (
    <span
      className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-1.5 text-[13px]"
      title={`Wall-clock ${formatDuration(wall)} · active ${formatDuration(active)}`}
    >
      <Timer className="size-4" aria-hidden />
      <span>Time on case</span>
      <span className="font-mono font-medium">{formatDuration(wall)}</span>
      <span className="hidden font-mono text-white/60 lg:inline">· active {formatDuration(active)}</span>
    </span>
  );
  return slot ? createPortal(content, slot) : null;
}
