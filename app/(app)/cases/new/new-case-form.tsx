"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { api } from "@/lib/client/api";

export function NewCaseForm() {
  const router = useRouter();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/cases", { body: { alertNumber: value } });
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
          placeholder="ALR-2026-000123"
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          aria-invalid={!!error}
          aria-describedby={error ? "alert-error" : "alert-hint"}
          required
          autoFocus
        />
        <Button type="submit" variant="primary" disabled={busy || !value.trim()}>
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
    </form>
  );
}
