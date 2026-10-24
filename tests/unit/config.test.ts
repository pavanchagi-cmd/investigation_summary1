import { describe, expect, it } from "vitest";
import { AppConfig, DEFAULT_CONFIG, RankingWeights } from "@/lib/config/schema";

describe("config schema", () => {
  it("accepts the defaults", () => {
    expect(AppConfig.safeParse(DEFAULT_CONFIG).success).toBe(true);
  });
  it("rejects ranking weights that do not sum to 1", () => {
    expect(RankingWeights.safeParse({ amount: 0.6, high_risk: 0.3, weak_reg: 0.15 }).success).toBe(false);
  });
  it("keeps real-world country risk out of defaults (placeholder codes only)", () => {
    const codes = [...DEFAULT_CONFIG.high_risk_countries, ...DEFAULT_CONFIG.weak_regulation_countries].map((c) => c.code);
    for (const c of codes) expect(c).toMatch(/^X[A-Z]$/);
  });
});
