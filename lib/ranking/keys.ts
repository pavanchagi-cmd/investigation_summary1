/**
 * Normalised counterparty key (spec section 8): lower-cased name with punctuation and legal
 * suffixes stripped, plus the account number when present.
 */
export function normaliseName(name: string, legalSuffixes: string[]): string {
  const suffixes = new Set(legalSuffixes.map((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "")));
  const tokens = name
    .toLowerCase()
    .replace(/\b([a-z])\.(?=[a-z]\.)/g, "$1") // "s.a." → "sa."
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(" ");
}

export function normaliseAccount(account: string | null | undefined): string | null {
  if (!account) return null;
  const a = account.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return a || null;
}

export function counterpartyKey(name: string | null | undefined, account: string | null | undefined, legalSuffixes: string[]) {
  const n = name ? normaliseName(name, legalSuffixes) : "(no name)";
  const a = normaliseAccount(account);
  return a ? `${n}|${a}` : n;
}
