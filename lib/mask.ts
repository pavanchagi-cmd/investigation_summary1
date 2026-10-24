/** Masks an account number to its last 4 characters: "••••1234". */
export function maskAccount(account: string | null | undefined): string | null {
  if (account == null) return null;
  const compact = String(account).replace(/[\s-]/g, "");
  if (compact.length === 0) return null;
  return "••••" + compact.slice(-4);
}

/** Masks every account-looking number (6+ digits) inside free text. */
export function maskAccountsInText(text: string): string {
  return text.replace(/\b\d[\d\s-]{4,}\d\b/g, (m) => {
    const digits = m.replace(/[\s-]/g, "");
    return digits.length >= 6 ? "••••" + digits.slice(-4) : m;
  });
}
