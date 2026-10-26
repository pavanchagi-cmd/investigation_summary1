"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { api } from "@/lib/client/api";
import type { AppConfig, ConfigKey } from "@/lib/config/schema";

const RULE_FIELDS: { key: keyof AppConfig["rules"]; label: string; hint: string; step?: string }[] = [
  { key: "large_amount_threshold", label: "Large amount threshold", hint: "Base currency" },
  { key: "large_vs_avg_multiple", label: "Large vs average multiple", hint: "× client average", step: "0.1" },
  { key: "passthrough_days", label: "Pass-through days", hint: "Days from receipt to payment" },
  { key: "passthrough_tolerance", label: "Pass-through tolerance", hint: "0.05 = 5%", step: "0.01" },
  { key: "volume_change_multiple", label: "Volume change multiple", hint: "× prior 6-month or KYC value", step: "0.1" },
  { key: "funnel_min_counterparties", label: "Funnel: distinct counterparties", hint: "Many-to-one / one-to-many" },
  { key: "funnel_window_days", label: "Funnel window (days)", hint: "" },
  { key: "circular_days", label: "Circular return window (days)", hint: "" },
  { key: "round_unit", label: "Round unit", hint: "Multiples of" },
  { key: "round_pct_alert", label: "Round % alert", hint: "0.4 = 40% of count", step: "0.01" },
  { key: "reporting_threshold", label: "Reporting threshold", hint: "Wire structuring" },
  { key: "near_band_low", label: "Near band low", hint: "0.9 = 90%", step: "0.0001" },
  { key: "near_band_high", label: "Near band high", hint: "0.9999 = 99.99%", step: "0.0001" },
  { key: "window_days", label: "Structuring window (days)", hint: "" },
  { key: "min_count", label: "Structuring min count", hint: "Near-band wires in window" },
];

function useSaver() {
  const router = useRouter();
  const [msg, setMsg] = React.useState<{ key: string; ok: boolean; text: string } | null>(null);
  const save = async (key: ConfigKey, value: unknown) => {
    try {
      await api("/api/admin/config", { method: "PUT", body: { key, value } });
      setMsg({ key, ok: true, text: "Saved. Open cases will re-run the analysis." });
      router.refresh();
    } catch (e) {
      setMsg({ key, ok: false, text: (e as Error).message });
    }
  };
  const Status = ({ k }: { k: string }) =>
    msg?.key === k ? (
      <p role="status" className={`mt-2 text-[13px] ${msg.ok ? "text-ok" : "text-risk"}`}>
        {msg.text}
      </p>
    ) : null;
  return { save, Status };
}

const listToText = (l: { code: string; source: string; effectiveDate: string }[]) => l.map((x) => `${x.code} | ${x.source} | ${x.effectiveDate}`).join("\n");
const textToList = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [code, source, effectiveDate] = l.split("|").map((s) => s.trim());
      return { code: (code ?? "").toUpperCase(), source: source ?? "", effectiveDate: effectiveDate ?? "" };
    });

export function AdminSettings({
  config,
  users,
  selfId,
  llm,
}: {
  config: AppConfig;
  users: { id: number; name: string; email: string; role: string; permissions: string[] }[];
  selfId: number;
  llm: { model: string; backend: string; mock: boolean };
}) {
  const { save, Status } = useSaver();
  const [rules, setRules] = React.useState(config.rules);
  const [weights, setWeights] = React.useState(config.ranking_weights);
  const [hr, setHr] = React.useState(listToText(config.high_risk_countries));
  const [wr, setWr] = React.useState(listToText(config.weak_regulation_countries));
  const [kw, setKw] = React.useState(config.institution_risk_keywords.join("\n"));
  const [sfx, setSfx] = React.useState(config.legal_suffixes.join("\n"));
  const [fx, setFx] = React.useState(Object.entries(config.fx_rates.rates).map(([k, v]) => `${k} ${v}`).join("\n"));
  const [fxSource, setFxSource] = React.useState(config.fx_rates.source);
  const [regex, setRegex] = React.useState(config.alert_number_regex);
  const [baseline, setBaseline] = React.useState(config.manual_baseline_minutes?.toString() ?? "");
  const [retention, setRetention] = React.useState(String(config.retention_days));
  const [check, setCheck] = React.useState<string | null>(null);
  const [purge, setPurge] = React.useState<string | null>(null);
  const sum = weights.amount + weights.high_risk + weights.weak_reg;

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-8 md:px-10">
      <h1 className="text-[24px] font-semibold">Admin settings</h1>

      <Card>
        <CardHeader title="Gemini" />
        <p className="text-[14px]">
          Model <span className="font-mono">{llm.model}</span> · backend <span className="font-mono">{llm.backend}</span>
          {llm.mock ? " · mock mode (GEMINI_MOCK=1)" : ""}
        </p>
        <p className="mt-1 text-[13px] text-muted">Set GEMINI_MODEL and GEMINI_API_KEY in the Vercel environment variables. Use synthetic data only with a free-tier key.</p>
        <Button
          className="mt-3"
          onClick={async () => {
            setCheck("Checking…");
            try {
              const r = await api<{ ok: boolean; message: string }>("/api/admin/llm-check", { body: {} });
              setCheck(`${r.ok ? "✓" : "✗"} ${r.message}`);
            } catch (e) {
              setCheck(`✗ ${(e as Error).message}`);
            }
          }}
        >
          Check Gemini connection
        </Button>
        {check ? (
          <p role="status" className="mt-2 text-[13px]">
            {check}
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Scenario rule thresholds" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RULE_FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={`rule-${f.key}`}>{f.label}</Label>
              <Input
                id={`rule-${f.key}`}
                type="number"
                step={f.step ?? "1"}
                className="font-mono"
                value={String(rules[f.key])}
                onChange={(e) => setRules((r) => ({ ...r, [f.key]: Number(e.target.value) }))}
              />
              {f.hint ? <p className="mt-1 text-[12px] text-muted">{f.hint}</p> : null}
            </div>
          ))}
        </div>
        <Button variant="primary" className="mt-4" onClick={() => save("rules", rules)}>
          Save thresholds
        </Button>
        <Status k="rules" />
      </Card>

      <Card>
        <CardHeader title="Counterparty ranking weights" />
        <div className="grid gap-4 sm:grid-cols-3">
          {(["amount", "high_risk", "weak_reg"] as const).map((k) => (
            <div key={k}>
              <Label htmlFor={`w-${k}`}>{k === "amount" ? "Amount" : k === "high_risk" ? "High-risk country" : "Weak regulation / institution"}</Label>
              <Input id={`w-${k}`} type="number" step="0.05" className="font-mono" value={String(weights[k])} onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} />
            </div>
          ))}
        </div>
        <p className={`mt-2 text-[13px] ${Math.abs(sum - 1) < 1e-9 ? "text-muted" : "text-risk"}`}>Sum {sum.toFixed(2)} (must be 1.00)</p>
        <Button variant="primary" className="mt-3" onClick={() => save("ranking_weights", weights)}>
          Save weights
        </Button>
        <Status k="ranking_weights" />
      </Card>

      <Card>
        <CardHeader title="Country and institution lists" />
        <p className="mb-4 text-[13px] text-muted">
          One entry per line: <span className="font-mono">CODE | source | YYYY-MM-DD</span>. The seeded entries are placeholders; the bank supplies the real lists.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label htmlFor="hr">High-risk countries</Label>
            <Textarea id="hr" className="min-h-32 font-mono text-[13px]" value={hr} onChange={(e) => setHr(e.target.value)} />
            <Button className="mt-2" onClick={() => save("high_risk_countries", textToList(hr))}>
              Save
            </Button>
            <Status k="high_risk_countries" />
          </div>
          <div>
            <Label htmlFor="wr">Weak-regulation countries</Label>
            <Textarea id="wr" className="min-h-32 font-mono text-[13px]" value={wr} onChange={(e) => setWr(e.target.value)} />
            <Button className="mt-2" onClick={() => save("weak_regulation_countries", textToList(wr))}>
              Save
            </Button>
            <Status k="weak_regulation_countries" />
          </div>
          <div>
            <Label htmlFor="kw">Institution risk keywords (one per line)</Label>
            <Textarea id="kw" className="min-h-32 font-mono text-[13px]" value={kw} onChange={(e) => setKw(e.target.value)} />
            <Button className="mt-2" onClick={() => save("institution_risk_keywords", kw.split("\n").map((s) => s.trim()).filter(Boolean))}>
              Save
            </Button>
            <Status k="institution_risk_keywords" />
          </div>
          <div>
            <Label htmlFor="sfx">Legal suffixes stripped from names</Label>
            <Textarea id="sfx" className="min-h-32 font-mono text-[13px]" value={sfx} onChange={(e) => setSfx(e.target.value)} />
            <Button className="mt-2" onClick={() => save("legal_suffixes", sfx.split("\n").map((s) => s.trim()).filter(Boolean))}>
              Save
            </Button>
            <Status k="legal_suffixes" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Rates, formats, baseline and retention" />
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <Label htmlFor="fx">FX rates to {config.fx_rates.base} (one per line: CCY rate)</Label>
            <Textarea id="fx" className="min-h-32 font-mono text-[13px]" value={fx} onChange={(e) => setFx(e.target.value)} />
            <Label htmlFor="fx-source" className="mt-2">
              Rate source
            </Label>
            <Input id="fx-source" value={fxSource} onChange={(e) => setFxSource(e.target.value)} />
            <Button
              className="mt-2"
              onClick={() =>
                save("fx_rates", {
                  base: config.fx_rates.base,
                  source: fxSource,
                  rates: Object.fromEntries(
                    fx
                      .split("\n")
                      .map((l) => l.trim().split(/\s+/))
                      .filter((p) => p.length === 2)
                      .map(([c, r]) => [c.toUpperCase(), Number(r)]),
                  ),
                })
              }
            >
              Save rates
            </Button>
            <Status k="fx_rates" />
          </div>
          <div className="space-y-4">
            <div>
              <Label htmlFor="regex">Alert number format (regular expression)</Label>
              <Input id="regex" className="font-mono" value={regex} onChange={(e) => setRegex(e.target.value)} />
              <Button className="mt-2" onClick={() => save("alert_number_regex", regex)}>
                Save
              </Button>
              <Status k="alert_number_regex" />
            </div>
            <div>
              <Label htmlFor="baseline">Manual baseline (minutes per case)</Label>
              <Input id="baseline" type="number" className="font-mono" placeholder="Not set" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
              <p className="mt-1 text-[12px] text-muted">From the pre-tool time study. Time saved is shown on the dashboard only when this is set.</p>
              <Button className="mt-2" onClick={() => save("manual_baseline_minutes", baseline.trim() ? Number(baseline) : null)}>
                Save
              </Button>
              <Status k="manual_baseline_minutes" />
            </div>
            <div>
              <Label htmlFor="retention">Retention period (days)</Label>
              <Input id="retention" type="number" className="font-mono" value={retention} onChange={(e) => setRetention(e.target.value)} />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => save("retention_days", Number(retention))}>Save</Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (!window.confirm(`Delete every case started more than ${config.retention_days} days ago, with its files? This cannot be undone.`)) return;
                    try {
                      const r = await api<{ cases: number; files: number }>("/api/admin/purge", { body: {} });
                      setPurge(`Purged ${r.cases} case(s) and ${r.files} file(s).`);
                    } catch (e) {
                      setPurge((e as Error).message);
                    }
                  }}
                >
                  Purge demo data now
                </Button>
              </div>
              <Status k="retention_days" />
              {purge ? <p className="mt-2 text-[13px]">{purge}</p> : null}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Users and roles" />
        <UsersTable users={users} selfId={selfId} />
      </Card>
    </div>
  );
}

function UsersTable({ users, selfId }: { users: { id: number; name: string; email: string; role: string; permissions: string[] }[]; selfId: number }) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<string | null>(null);
  const patch = async (body: object) => {
    try {
      const r = await api<{ note: string }>("/api/admin/users", { method: "PATCH", body });
      setMsg(r.note);
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-[14px]">
        <thead className="text-[12.5px] text-muted">
          <tr>
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Email</th>
            <th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium">Full account numbers</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-t border-line">
              <td className="py-2 pr-3">
                <NameInput key={u.name} id={u.id} name={u.name} onSave={(name) => patch({ id: u.id, name })} />
              </td>
              <td className="py-2 font-mono text-[13px]">{u.email}</td>
              <td className="py-2">
                <Select aria-label={`Role for ${u.name}`} className="h-9 w-[140px]" value={u.role} disabled={u.id === selfId} onChange={(e) => patch({ id: u.id, role: e.target.value })}>
                  <option value="analyst">Analyst</option>
                  <option value="qa">QA reviewer</option>
                  <option value="admin">Admin</option>
                </Select>
              </td>
              <td className="py-2">
                <label className="inline-flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    className="accent-[#1F4FD1]"
                    checked={u.permissions.includes("view_full_account")}
                    onChange={(e) => patch({ id: u.id, viewFullAccount: e.target.checked })}
                  />
                  view_full_account
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg ? <p className="mt-2 text-[13px] text-muted">{msg}</p> : null}
    </div>
  );
}

function NameInput({ id, name, onSave }: { id: number; name: string; onSave: (name: string) => void }) {
  const [value, setValue] = React.useState(name);
  const dirty = value.trim() !== name && value.trim().length >= 2;
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) onSave(value.trim());
      }}
    >
      <Input id={`user-name-${id}`} aria-label={`Name for ${name}`} className="h-9 w-[180px]" value={value} maxLength={80} onChange={(e) => setValue(e.target.value)} />
      {dirty ? (
        <Button type="submit" size="sm" variant="primary" aria-label={`Save name for ${name}`}>
          Save
        </Button>
      ) : null}
    </form>
  );
}
