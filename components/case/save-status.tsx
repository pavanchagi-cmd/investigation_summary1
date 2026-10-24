"use client";

import * as React from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";

type State = { pending: number; error: string | null; saved: boolean };
type Ctx = { track: <T>(p: Promise<T>) => Promise<T>; state: State };

const SaveCtx = React.createContext<Ctx | null>(null);

/** Shared "All changes saved" indicator: every autosave goes through track(). */
export function SaveStatusProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<State>({ pending: 0, error: null, saved: false });
  const track = React.useCallback(async <T,>(p: Promise<T>) => {
    setState((s) => ({ ...s, pending: s.pending + 1, error: null }));
    try {
      const v = await p;
      setState((s) => ({ pending: s.pending - 1, error: s.error, saved: true }));
      return v;
    } catch (err) {
      setState((s) => ({ pending: s.pending - 1, error: (err as Error).message, saved: false }));
      throw err;
    }
  }, []);
  return <SaveCtx.Provider value={{ track, state }}>{children}</SaveCtx.Provider>;
}

export function useSave() {
  const ctx = React.useContext(SaveCtx);
  if (!ctx) throw new Error("useSave outside SaveStatusProvider");
  return ctx.track;
}

export function SaveIndicator() {
  const ctx = React.useContext(SaveCtx);
  if (!ctx) return null;
  const { pending, error, saved } = ctx.state;
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
      {pending > 0 ? (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
        </>
      ) : error ? (
        <span className="inline-flex items-center gap-1.5 text-risk">
          <TriangleAlert className="size-3.5" aria-hidden /> Not saved: {error}
        </span>
      ) : saved ? (
        <>
          <Check className="size-3.5 text-ok" aria-hidden /> All changes saved
        </>
      ) : null}
    </span>
  );
}
