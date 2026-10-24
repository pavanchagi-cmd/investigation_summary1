import { formatDate } from "./format";

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["en"], { type: "region" }) : null;

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  if (/^X[A-Z]$/.test(code)) return code; // placeholder list codes
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function compactMoney(n: number) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}m`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(0)}k`;
  return String(n);
}

/** Human display of Q3 field values (AI objects or analyst text). Accounts arrive masked from the server. */
export function formatFieldValue(fieldKey: string, v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDate(v);
    if (fieldKey === "incorporation_country") return countryName(v);
    return v;
  }
  if (typeof v === "number") return String(v);
  if (fieldKey === "declared_turnover" && typeof v === "object") {
    const t = v as { amount: number; currency: string };
    return `${t.currency} ${t.amount.toLocaleString("en-US")}`;
  }
  if (fieldKey === "expected_activity" && typeof v === "object") {
    const e = v as { monthly_value: number | null; monthly_volume: number | null; currency: string | null; countries: string[]; products: string[] };
    return [
      e.monthly_value != null ? `~${e.currency ?? ""} ${compactMoney(e.monthly_value)} / month`.trim() : null,
      e.monthly_volume != null ? `~${e.monthly_volume} txns / month` : null,
      e.countries?.length ? e.countries.join(", ") : null,
      e.products?.length ? e.products.join(", ") : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (fieldKey === "accounts" && Array.isArray(v)) {
    return (v as { account_number: string; opened_date: string | null }[])
      .map((a) => [a.account_number, a.opened_date ? formatDate(a.opened_date) : null].filter(Boolean).join(" · "))
      .join("; ");
  }
  if (fieldKey === "prior_alerts_sars" && typeof v === "object") {
    const p = v as { alerts: number | null; sars: number | null };
    return `${p.alerts ?? "?"} alert${p.alerts === 1 ? "" : "s"} · ${p.sars ?? "?"} SAR${p.sars === 1 ? "" : "s"}`;
  }
  return JSON.stringify(v);
}
