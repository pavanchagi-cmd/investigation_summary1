import { describe, expect, it } from "vitest";
import { maskAccount, maskAccountsInText } from "@/lib/mask";
import { formatDate, formatDuration } from "@/lib/format";
import { formatSourceRef, parseSourceRef } from "@/lib/source-ref";

describe("maskAccount", () => {
  it("keeps only the last 4 characters", () => {
    expect(maskAccount("123456782210")).toBe("••••2210");
    expect(maskAccount("1234-5678-4417")).toBe("••••4417");
  });
  it("returns null for empty input", () => {
    expect(maskAccount(null)).toBeNull();
    expect(maskAccount("  ")).toBeNull();
  });
  it("masks account-like numbers inside text", () => {
    expect(maskAccountsInText("Paid from a/c 5021004417 on 02 Apr")).toBe("Paid from a/c ••••4417 on 02 Apr");
    expect(maskAccountsInText("Amount 9,950.00 on 2026")).toBe("Amount 9,950.00 on 2026");
  });
});

describe("format", () => {
  it("formats durations and dates", () => {
    expect(formatDuration(1572)).toBe("00:26:12");
    expect(formatDate("2026-07-01")).toBe("01 Jul 2026");
  });
});

describe("source refs", () => {
  it("round-trips page and row references", () => {
    expect(formatSourceRef({ file: "kyc_profile.pdf", page: 2 })).toBe("kyc_profile.pdf · p.2");
    expect(parseSourceRef("transactions_Q3.xlsx · rows 12–58")).toEqual({ file: "transactions_Q3.xlsx", row: 12, rowEnd: 58 });
    expect(parseSourceRef('alert_report.pdf · p.1 · "Lookback 90 days"')).toEqual({
      file: "alert_report.pdf",
      page: 1,
      note: '"Lookback 90 days"',
    });
  });
});
