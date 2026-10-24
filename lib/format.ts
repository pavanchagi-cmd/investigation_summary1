const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1570 → "00:26:10" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

/** "2026-07-01" → "01 Jul 2026" */
export function formatDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const out = `${m[3]} ${MONTHS[Number(m[2]) - 1]}`;
  return withYear ? `${out} ${m[1]}` : out;
}

/** 1284000 → "1,284,000"; decimals optional. */
export function formatAmount(n: number | null | undefined, decimals = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatMoney(n: number | null | undefined, ccy = "USD", decimals = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${ccy} ${formatAmount(n, decimals)}`;
}

export function formatPct(fraction: number, decimals = 1): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}
