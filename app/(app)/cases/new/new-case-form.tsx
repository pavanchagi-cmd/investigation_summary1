"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { api } from "@/lib/client/api";

const DEMO_ALERTS = [
  { number: "ALR-2026-000123", label: "Kestrel Trading (as in the design)" },
  { number: "ALR-2026-000101", label: "Large amount" },
  { number: "ALR-2026-000102", label: "Pattern of funds" },
  { number: "ALR-2026-000103", label: "Round dollar" },
];

export function NewCaseForm() {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e?: React.FormEvent, alertNumber = value) {
    e?.preventDefault();
    if (!alertNumber.trim()) {
      setError("Type an alert number first, or pick one of the demo alerts below.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/cases", { body: { alertNumber } });
      router.push(`/cases/${id}/intake`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Label htmlFor="alert-number">Alert number (required)</Label>
      <div className="flex flex-wrap gap-3">
        <Input
          id="alert-number"
          name="alertNumber"
          className="max-w-[420px] font-mono"
          placeholder="e.g. ALR-2026-000123"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          aria-invalid={!!error}
          aria-describedby={error ? "alert-error" : "alert-hint"}
          required
          autoFocus
        />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Loading…" : "Load alert"}
        </Button>
      </div>
      {error ? (
        <p id="alert-error" role="alert" className="mt-2 text-[13px] text-risk">
          {error}
        </p>
      ) : (
        <p id="alert-hint" className="mt-2 text-[12.5px] text-muted">
          Format ALR-YYYY-NNNNNN.
        </p>
      )}
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-[13px] text-muted">Or open a demo alert (synthetic data, documents attached on the next screen):</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO_ALERTS.map((d) => (
            <Button
              key={d.number}
              size="sm"
              disabled={busy}
              onClick={() => {
                setValue(d.number);
                void submit(undefined, d.number);
              }}
            >
              <span className="font-mono">{d.number}</span>
              <span className="text-muted">· {d.label}</span>
            </Button>
          ))}
        </div>
      </div>
    </form>
  );
}
