"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { AiDraftBadge, MaskedAccount } from "@/components/case/badges";
import { SourceChip } from "@/components/case/document-preview";
import { useSave } from "@/components/case/save-status";
import { api } from "@/lib/client/api";
import { countryName, formatFieldValue } from "@/lib/display";
import { formatAmount, formatDate } from "@/lib/format";
import type { FieldView } from "@/lib/cases/fields";
import type { CounterpartyView } from "@/lib/analysis/queries";
import type { RankingWeights } from "@/lib/config/schema";
import { cn } from "@/lib/utils";
import { EditableField } from "./editable-field";

const ENTITY_TYPES = ["Private company", "Public company", "Partnership", "Sole proprietor", "Trust", "Individual", "Other"];

export function ClientScreen(props: {
  caseId: number;
  readOnly: boolean;
  fields: FieldView[];
  counterparties: CounterpartyView[];
  weights: RankingWeights;
  ownAccount: { count: number; total: number } | null;
  baseCcy: string;
}) {
  return (
    <div className="space-y-6">
      <Q3Card {...props} />
      <Q4Card {...props} />
      <div className="flex flex-wrap justify-between gap-3">
        <Button asChild size="lg">
          <Link href={`/cases/${props.caseId}/intake`}>Back</Link>
        </Button>
        <Button asChild variant="primary" size="lg">
          <Link href={`/cases/${props.caseId}/purpose`}>
            Continue to purpose & red flags <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Q3Card({ caseId, readOnly, fields }: Parameters<typeof ClientScreen>[0]) {
  const get = (k: string) => fields.find((f) => f.fieldKey === k);
  const state = fields.some((f) => f.status === "edited") ? "edited" : "ai";
  const common = { caseId, readOnly };
  return (
    <Card>
      <CardHeader title="Q3 · Client details (KYC)" aside={fields.length ? <AiDraftBadge state={state} /> : null} />
      {fields.length === 0 ? (
        <p className="text-[14px] text-muted">KYC fields are filled from the KYC profile and alert report once they are parsed.</p>
      ) : (
        <>
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
            <EditableField {...common} fieldKey="client_name" label="Client name" field={get("client_name")} />
            <EditableField {...common} fieldKey="client_id" label="Client ID / CIF" field={get("client_id")} />
            <EntityTypeField {...common} field={get("entity_type")} />
            <div className="min-w-0">
              <div className="grid grid-cols-2 gap-2">
                <EditableField {...common} fieldKey="incorporation_date" label="Incorporated" field={get("incorporation_date")} />
                <EditableField {...common} fieldKey="incorporation_country" label="Country" field={get("incorporation_country")} />
              </div>
            </div>
            <EditableField {...common} fieldKey="nature_of_business" label="Nature of business" field={get("nature_of_business")} />
            <EditableField {...common} fieldKey="industry_code" label="Industry code" field={get("industry_code")} hint="Analyst to add if known" />
            <EditableField {...common} fieldKey="declared_turnover" label="Declared annual turnover" field={get("declared_turnover")} />
            <EditableField {...common} fieldKey="expected_activity" label="Expected activity" field={get("expected_activity")} />
            <EditableField {...common} fieldKey="accounts" label="Accounts involved · opened" field={get("accounts")} />
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <FlagTile {...common} fieldKey="risk_rating" label="Risk rating" field={get("risk_rating")} tone={(v) => (/high/i.test(v) ? "risk" : undefined)} />
            <FlagTile {...common} fieldKey="pep" label="PEP" field={get("pep")} tone={(v) => (/^yes/i.test(v) ? "risk" : undefined)} />
            <FlagTile {...common} fieldKey="sanctions" label="Sanctions" field={get("sanctions")} tone={(v) => (v && !/no match|^no$|none/i.test(v) ? "risk" : undefined)} />
            <FlagTile {...common} fieldKey="adverse_media" label="Adverse media" field={get("adverse_media")} tone={(v) => (v && !/^none|^no$/i.test(v) ? "ai" : undefined)} />
            <FlagTile {...common} fieldKey="prior_alerts_sars" label="Prior alerts / SARs" field={get("prior_alerts_sars")} />
          </div>
        </>
      )}
    </Card>
  );
}

function EntityTypeField({ caseId, readOnly, field }: { caseId: number; readOnly: boolean; field: FieldView | undefined }) {
  const router = useRouter();
  const track = useSave();
  const current = typeof field?.value === "string" ? field.value : "";
  const options = current && !ENTITY_TYPES.includes(current) ? [current, ...ENTITY_TYPES] : ENTITY_TYPES;
  return (
    <div>
      <Label htmlFor="q3-entity_type">Entity type</Label>
      <Select
        id="q3-entity_type"
        value={current}
        disabled={readOnly}
        className={cn(!current && "border-dashed border-ai/40 italic text-ai")}
        onChange={async (e) => {
          await track(api(`/api/cases/${caseId}/fields`, { method: "PATCH", body: { question: "q3", fieldKey: "entity_type", value: e.target.value || null } }));
          router.refresh();
        }}
      >
        {!current ? <option value="">Not provided in documents</option> : null}
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </Select>
      <div className="mt-1">
        <SourceChip source={field?.sourceRef} />
      </div>
    </div>
  );
}

function FlagTile({
  caseId,
  readOnly,
  fieldKey,
  label,
  field,
  tone,
}: {
  caseId: number;
  readOnly: boolean;
  fieldKey: string;
  label: string;
  field: FieldView | undefined;
  tone?: (v: string) => "risk" | "ai" | undefined;
}) {
  const router = useRouter();
  const track = useSave();
  const display = formatFieldValue(fieldKey, field?.value);
  const [value, setValue] = React.useState(display);
  React.useEffect(() => setValue(display), [display]);
  const t = tone?.(display);
  return (
    <div className={cn("rounded-lg border px-4 py-3", t === "ai" ? "border-ai/40 bg-ai-soft" : "border-line")}>
      <label htmlFor={`tile-${fieldKey}`} className="text-[12.5px] text-muted">
        {label}
      </label>
      <input
        id={`tile-${fieldKey}`}
        value={value}
        readOnly={readOnly}
        placeholder="Not provided in documents"
        onChange={(e) => setValue(e.target.value)}
        onBlur={async () => {
          if (value.trim() === display.trim()) return;
          await track(api(`/api/cases/${caseId}/fields`, { method: "PATCH", body: { question: "q3", fieldKey, value: value.trim() || null } }));
          router.refresh();
        }}
        className={cn(
          "mt-0.5 w-full bg-transparent text-[15px] font-semibold placeholder:text-[13px] placeholder:font-normal placeholder:italic placeholder:text-ai focus:outline-none",
          t === "risk" ? "text-risk" : t === "ai" ? "text-ai" : "text-ink",
        )}
      />
      <div className="mt-1">
        <SourceChip source={field?.sourceRef} className="text-[10.5px]" />
      </div>
    </div>
  );
}

const DIRECTION_LABEL = { sending: "Sending", receiving: "Receiving", both: "Both" } as const;

function FlagBadges({ flags }: { flags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} tone={/high-risk|weak|indicator|no bank/i.test(f) ? "risk" : "accent"} className="font-mono text-[11px]">
          {f.replace(/^Indicator: /, "")}
        </Badge>
      ))}
    </div>
  );
}

function Q4Card({ caseId, readOnly, counterparties, weights, ownAccount, baseCcy }: Parameters<typeof ClientScreen>[0]) {
  const top = counterparties.filter((c) => c.inTop6).sort((a, b) => a.rank - b.rank);
  const rest = counterparties.filter((c) => !c.inTop6);
  const [swapTarget, setSwapTarget] = React.useState<{ row: CounterpartyView; position: number } | null>(null);

  return (
    <div className={cn("grid grid-cols-1 gap-6", swapTarget ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "")}>
      <Card className="min-w-0">
        <CardHeader
          title="Q4 · Top 6 counterparties"
          aside={
            <>
              {top.length ? <AiDraftBadge label="AI ranked – analyst to verify" state={top.some((t) => t.swappedReason) ? "edited" : "ai"} /> : null}
              <FullListDialog counterparties={counterparties} baseCcy={baseCcy} />
            </>
          }
        />
        <p className="-mt-2 mb-4 text-[13px] text-muted">
          Ranked by score: total amount ({Math.round(weights.amount * 100)}%), high-risk country ({Math.round(weights.high_risk * 100)}%), weakly regulated
          jurisdiction or institution ({Math.round(weights.weak_reg * 100)}%). Ranking is deterministic code; weights and lists are set by admin.
          {ownAccount?.count ? ` Own-account transfers excluded: ${ownAccount.count} txns · ${baseCcy} ${formatAmount(ownAccount.total)}.` : ""}
        </p>
        {top.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">
            No in-period transactions to rank yet. Upload the transaction list and set the review period on screen 1.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[960px] text-left text-[13px]">
              <thead className="bg-page text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Counterparty</th>
                  <th className="px-3 py-2.5 font-medium">Direction</th>
                  <th className="px-3 py-2.5 font-medium">Country · bank</th>
                  <th className="px-3 py-2.5 text-right font-medium">Txns</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total ({baseCcy})</th>
                  <th className="px-3 py-2.5 text-right font-medium">% flow</th>
                  <th className="px-3 py-2.5 font-medium">First – last</th>
                  <th className="px-3 py-2.5 font-medium">Flags · why ranked</th>
                  <th className="px-3 py-2.5">
                    <span className="sr-only">Swap</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {top.map((c, i) => (
                  <tr key={c.id} className={cn("border-t border-line align-top", swapTarget?.row.id === c.id && "bg-accent-soft")}>
                    <td className="px-3 py-3 font-mono">{i + 1}</td>
                    <td className="px-3 py-3">
                      <div className="font-semibold">{c.name}</div>
                      <MaskedAccount value={c.account} />
                      {c.swappedReason ? <div className="mt-1 text-[11.5px] text-accent">Swapped in: {c.swappedReason}</div> : null}
                    </td>
                    <td className="px-3 py-3">{DIRECTION_LABEL[c.direction as keyof typeof DIRECTION_LABEL]}</td>
                    <td className="px-3 py-3">
                      {c.country ?? "—"} · {c.bank ?? "No bank stated"}
                      {c.bankCountry && c.bankCountry !== c.country ? ` (${c.bankCountry})` : ""}
                      <div className="text-[11.5px] text-muted">{countryName(c.country)}</div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">{c.txnCount}</td>
                    <td className="px-3 py-3 text-right font-mono">{formatAmount(c.totalAmount)}</td>
                    <td className="px-3 py-3 text-right font-mono">{c.pctOfFlow.toFixed(1)}</td>
                    <td className="px-3 py-3 font-mono text-[12px]">
                      {formatDate(c.firstDate, false)} – {formatDate(c.lastDate, false)}
                    </td>
                    <td className="max-w-[260px] px-3 py-3">
                      <FlagBadges flags={c.flags} />
                      <div className="mt-1 text-[12px] text-muted">{c.reason}</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      {!readOnly && rest.length ? (
                        <Button size="sm" onClick={() => setSwapTarget({ row: c, position: i + 1 })}>
                          Swap
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {swapTarget ? (
        <SwapPanel caseId={caseId} target={swapTarget} candidates={rest} baseCcy={baseCcy} onClose={() => setSwapTarget(null)} />
      ) : null}
    </div>
  );
}

function SwapPanel({
  caseId,
  target,
  candidates,
  baseCcy,
  onClose,
}: {
  caseId: number;
  target: { row: CounterpartyView; position: number };
  candidates: CounterpartyView[];
  baseCcy: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const track = useSave();
  const [q, setQ] = React.useState("");
  const [chosen, setChosen] = React.useState<number | null>(null);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const list = candidates.filter((c) => `${c.name} ${c.account ?? ""} ${c.country ?? ""} ${c.bank ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <aside aria-label={`Swap counterparty #${target.position}`} className="rounded-xl border-2 border-accent/30 bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold">Swap counterparty #{target.position}</h3>
        <Button variant="outline" size="icon" aria-label="Close swap panel" onClick={onClose}>
          ✕
        </Button>
      </div>
      <p className="mb-3 text-[12.5px] text-muted">Replacing {target.row.name}.</p>
      <Label htmlFor="swap-search">Search full ranked list</Label>
      <Input id="swap-search" placeholder="Name, account, country" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-3 max-h-[300px] space-y-2 overflow-auto" role="listbox" aria-label="Ranked counterparties">
        {list.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              role="option"
              aria-selected={chosen === c.id}
              onClick={() => setChosen(c.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[13px]",
                chosen === c.id ? "border-accent bg-accent-soft" : "border-line hover:bg-page",
              )}
            >
              <span>
                {c.rank} {c.name}
                {c.flags.some((f) => /indicator|high-risk|weak/i.test(f)) ? (
                  <Badge tone="ai" className="ml-2 text-[10.5px]">
                    {c.flags.filter((f) => /indicator|high-risk|weak/i.test(f)).map((f) => f.replace(/^Indicator: /, "").toUpperCase())[0]}
                  </Badge>
                ) : null}
              </span>
              <span className="font-mono">{formatAmount(c.totalAmount)}</span>
            </button>
          </li>
        ))}
        {list.length === 0 ? <li className="text-[13px] text-muted">No match.</li> : null}
      </ul>
      <Label htmlFor="swap-reason" className="mt-4">
        Reason for swap
      </Label>
      <Input id="swap-reason" placeholder="Required for audit log" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? <p className="mt-2 text-[13px] text-risk">{error}</p> : null}
      <Button
        variant="primary"
        className="mt-4 w-full"
        disabled={!chosen || reason.trim().length < 3}
        onClick={async () => {
          try {
            await track(api(`/api/cases/${caseId}/counterparties`, { method: "PATCH", body: { outId: target.row.id, inId: chosen, reason } }));
            onClose();
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Replace #{target.position}
      </Button>
      <p className="mt-2 text-[11.5px] text-muted">The top 6 always keeps six counterparties. Amounts in {baseCcy}.</p>
    </aside>
  );
}

function FullListDialog({ counterparties, baseCcy }: { counterparties: CounterpartyView[]; baseCcy: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">Full ranked list ({counterparties.length})</Button>
      </DialogTrigger>
      <DialogContent side="right" className="max-w-[860px]" title="Full ranked list" description="Score = 100 × (weights × components). Component values are 0–1.">
        <table className="w-full text-left text-[12.5px]">
          <thead className="text-muted">
            <tr>
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-2 font-medium">Counterparty</th>
              <th className="py-2 pr-2 text-right font-medium">Total ({baseCcy})</th>
              <th className="py-2 pr-2 text-right font-medium">Score</th>
              <th className="py-2 font-medium">Amount · high-risk · weak reg.</th>
            </tr>
          </thead>
          <tbody>
            {counterparties.map((c) => {
              const b = c.scoreBreakdown as { amount: number; high_risk: number; weak_reg: number } | null;
              return (
                <tr key={c.id} className={cn("border-t border-line", c.inTop6 && "bg-accent-soft/50")}>
                  <td className="py-2 pr-2 font-mono">{c.rank}</td>
                  <td className="py-2 pr-2">
                    {c.name} <MaskedAccount value={c.account} />
                    {c.inTop6 ? <Badge tone="accent" className="ml-2">Top 6</Badge> : null}
                  </td>
                  <td className="py-2 pr-2 text-right font-mono">{formatAmount(c.totalAmount)}</td>
                  <td className="py-2 pr-2 text-right font-mono">{c.score.toFixed(2)}</td>
                  <td className="py-2 font-mono">{b ? `${b.amount.toFixed(3)} · ${b.high_risk} · ${b.weak_reg}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
