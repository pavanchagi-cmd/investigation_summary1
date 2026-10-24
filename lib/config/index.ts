import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cases, config } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit/log";
import { AppConfig, DEFAULT_CONFIG, type ConfigKey } from "./schema";

export * from "./schema";

const ANALYSIS_KEYS: ConfigKey[] = [
  "rules",
  "ranking_weights",
  "high_risk_countries",
  "weak_regulation_countries",
  "institution_risk_keywords",
  "legal_suffixes",
];

/** Stored overrides merged over defaults. Invalid stored values fall back to the default. */
export async function getConfig(): Promise<AppConfig> {
  const db = await getDb();
  const rows = await db.select().from(config);
  const merged: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const row of rows) {
    if (!(row.key in DEFAULT_CONFIG)) continue;
    const parsed = AppConfig.shape[row.key as ConfigKey].safeParse(row.value);
    if (parsed.success) merged[row.key] = parsed.data;
  }
  return merged as AppConfig;
}

export async function setConfigValue(key: ConfigKey, value: unknown, actorId: number) {
  const parsed = AppConfig.shape[key].parse(value);
  const db = await getDb();
  const before = (await getConfig())[key];
  await db
    .insert(config)
    .values({ key, value: parsed, updatedBy: actorId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: config.key, set: { value: parsed, updatedBy: actorId, updatedAt: new Date() } });
  // Rule/ranking inputs changed: re-run analysis on open cases the next time they are viewed.
  // FX rates apply when a document is (re-)parsed; they never rewrite stored transactions.
  if (ANALYSIS_KEYS.includes(key)) {
    await db.update(cases).set({ needsAnalysis: true }).where(eq(cases.status, "drafting"));
  }
  await logAudit({ caseId: null, actorId, action: "config_updated", entity: "config", entityId: key, before, after: parsed });
  return parsed;
}
