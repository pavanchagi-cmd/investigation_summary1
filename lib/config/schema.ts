import { z } from "zod";

/**
 * All admin-editable settings. Values live in the `config` table, keyed by the top-level
 * property name; anything missing falls back to DEFAULT_CONFIG.
 */

const countryCode = z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166 alpha-2 code");

export const CountryListEntry = z.object({
  code: countryCode,
  source: z.string().min(1),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const RuleParams = z.object({
  large_amount_threshold: z.number().positive(),
  large_vs_avg_multiple: z.number().positive(),
  passthrough_days: z.number().int().positive(),
  passthrough_tolerance: z.number().min(0).max(1),
  volume_change_multiple: z.number().positive(),
  funnel_min_counterparties: z.number().int().min(2),
  funnel_window_days: z.number().int().positive(),
  circular_days: z.number().int().positive(),
  round_unit: z.number().positive(),
  round_pct_alert: z.number().min(0).max(1),
  reporting_threshold: z.number().positive(),
  near_band_low: z.number().min(0).max(1),
  near_band_high: z.number().min(0).max(1),
  window_days: z.number().int().positive(),
  min_count: z.number().int().min(1),
});
export type RuleParams = z.infer<typeof RuleParams>;

export const RankingWeights = z
  .object({ amount: z.number().min(0), high_risk: z.number().min(0), weak_reg: z.number().min(0) })
  .refine((w) => Math.abs(w.amount + w.high_risk + w.weak_reg - 1) < 1e-9, {
    message: "Weights must sum to 1",
  });
export type RankingWeights = z.infer<typeof RankingWeights>;

export const FxRates = z.object({
  base: z.string().regex(/^[A-Z]{3}$/),
  source: z.string(),
  rates: z.record(z.string().regex(/^[A-Z]{3}$/), z.number().positive()),
});
export type FxRates = z.infer<typeof FxRates>;

export const AppConfig = z.object({
  alert_number_regex: z.string().refine((s) => {
    try {
      new RegExp(s);
      return true;
    } catch {
      return false;
    }
  }, "Invalid regular expression"),
  rules: RuleParams,
  ranking_weights: RankingWeights,
  high_risk_countries: z.array(CountryListEntry),
  weak_regulation_countries: z.array(CountryListEntry),
  institution_risk_keywords: z.array(z.string().min(2)),
  legal_suffixes: z.array(z.string().min(1)),
  fx_rates: FxRates,
  manual_baseline_minutes: z.number().positive().nullable(),
  retention_days: z.number().int().positive(),
});
export type AppConfig = z.infer<typeof AppConfig>;
export type ConfigKey = keyof AppConfig;

export const DEFAULT_CONFIG: AppConfig = {
  alert_number_regex: "^ALR-\\d{4}-\\d{6}$",
  rules: {
    large_amount_threshold: 50_000,
    large_vs_avg_multiple: 3,
    passthrough_days: 3,
    passthrough_tolerance: 0.05,
    volume_change_multiple: 2,
    funnel_min_counterparties: 5,
    funnel_window_days: 7,
    circular_days: 30,
    round_unit: 1_000,
    round_pct_alert: 0.4,
    reporting_threshold: 10_000,
    near_band_low: 0.9,
    near_band_high: 0.9999,
    window_days: 7,
    min_count: 3,
  },
  ranking_weights: { amount: 0.6, high_risk: 0.25, weak_reg: 0.15 },
  // Placeholders only (user-assigned ISO codes). The bank supplies the real lists.
  high_risk_countries: [
    { code: "XA", source: "Placeholder – bank to supply", effectiveDate: "2026-01-01" },
    { code: "XB", source: "Placeholder – bank to supply", effectiveDate: "2026-01-01" },
  ],
  weak_regulation_countries: [
    { code: "XB", source: "Placeholder – bank to supply", effectiveDate: "2026-01-01" },
    { code: "XC", source: "Placeholder – bank to supply", effectiveDate: "2026-01-01" },
  ],
  institution_risk_keywords: [
    "money service",
    "msb",
    "exchange house",
    "unlicensed",
    "shell",
    "holdings",
    "nominee",
  ],
  legal_suffixes: ["ltd", "llc", "fze", "sa", "pvt", "limited", "private"],
  fx_rates: {
    base: "USD",
    source: "Placeholder demo rates – replace with the bank's rate table",
    rates: { USD: 1, EUR: 1.08, GBP: 1.27, INR: 0.012, AED: 0.2723, HKD: 0.128, SGD: 0.74 },
  },
  manual_baseline_minutes: null,
  retention_days: 90,
};

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG) as ConfigKey[];
