import type { RuleTxn } from "./types";

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(d, last));
  return dt.toISOString().slice(0, 10);
}

export const byDateThenId = (a: RuleTxn, b: RuleTxn) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

export function sum(xs: number[]) {
  return Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
}

export function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const fmt = (n: number, decimals = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const pct = (fraction: number, decimals = 0) => `${(fraction * 100).toFixed(decimals)}%`;

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export function uniqueSorted(ids: Iterable<number>) {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/** The single most frequent display name among transactions, for summaries. */
export function dominantName(txns: RuleTxn[]): string | null {
  const counts = new Map<string, number>();
  for (const t of txns) counts.set(t.cpName, (counts.get(t.cpName) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return best && n === txns.length ? best : null;
}
