import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { cases, subAlerts, users } from "../db/schema";
import { rng } from "./random";

export const DEMO_USERS = [
  { email: "analyst@demo.local", name: "Aditi Rao", role: "analyst" as const },
  { email: "analyst2@demo.local", name: "Sanjay Iyer", role: "analyst" as const },
  { email: "qa@demo.local", name: "Priya Nair", role: "qa" as const },
  { email: "admin@demo.local", name: "Demo Admin", role: "admin" as const },
];

export type SeedSummary = { usersCreated: number; historyCases: number; skippedUsers?: string };

const SCENARIOS = ["large_amount", "pattern_of_funds", "round_dollar", "wire_structuring"] as const;
const WEEKLY_MINUTES = [46, 41, 38, 34, 31, 29, 28, 27]; // design trend, oldest week first

/**
 * Idempotent seed: demo users, then ~40 approved historical cases (flagged synthetic_history)
 * over the last 8 weeks so the dashboard has data. Never overwrites existing rows.
 */
export async function seedDatabase(db: Db, opts: { password?: string; now?: Date }): Promise<SeedSummary> {
  const summary: SeedSummary = { usersCreated: 0, historyCases: 0 };
  if (!opts.password) {
    summary.skippedUsers = "SEED_USER_PASSWORD is not set; demo users were not created";
    console.warn(summary.skippedUsers);
  } else {
    const hash = await bcrypt.hash(opts.password, 10);
    for (const u of DEMO_USERS) {
      const inserted = await db.insert(users).values({ ...u, passwordHash: hash }).onConflictDoNothing({ target: users.email }).returning({ id: users.id });
      summary.usersCreated += inserted.length;
    }
  }

  const analysts = await db.select().from(users).where(eq(users.role, "analyst"));
  const [existing] = await db.select({ id: cases.id }).from(cases).where(eq(cases.syntheticHistory, true)).limit(1);
  if (existing || analysts.length === 0) return summary;

  const r = rng(2026_1024);
  const now = opts.now ?? new Date();
  let n = 0;
  for (let w = 0; w < 8; w++) {
    const perWeek = 4 + (w % 3 === 0 ? 2 : 1); // 5–6 cases a week
    for (let i = 0; i < perWeek; i++) {
      n++;
      const daysAgo = (7 - w) * 7 + r.int(0, 6);
      const approvedAt = new Date(now.getTime() - daysAgo * 86_400_000 - r.int(1, 8) * 3_600_000);
      const activeMin = Math.max(12, WEEKLY_MINUTES[w] + r.int(-4, 4));
      const activeSeconds = activeMin * 60 + r.int(0, 59);
      const wallSeconds = Math.round(activeSeconds * (1.08 + r.next() * 0.25));
      const roll = r.next();
      const disposition = roll < 0.3 ? "escalate_sar" : roll < 0.85 ? "close_nfa" : "request_info";
      const analyst = analysts[n % analysts.length];
      const [row] = await db
        .insert(cases)
        .values({
          alertNumber: `ALR-2026-${String(200 + n).padStart(6, "0")}`,
          status: "approved",
          createdBy: analyst.id,
          startedAt: new Date(approvedAt.getTime() - wallSeconds * 1000),
          approvedAt,
          timeToDraftSeconds: wallSeconds,
          activeSeconds,
          disposition,
          rationale: "Synthetic dashboard history – no case content.",
          pctAiKept: 60 + r.int(0, 26),
          needsAnalysis: false,
          syntheticHistory: true,
        })
        .onConflictDoNothing({ target: cases.alertNumber })
        .returning({ id: cases.id, alertNumber: cases.alertNumber });
      if (!row) continue;
      const first = SCENARIOS[r.int(0, 3)];
      const scen = r.next() < 0.35 ? [first, SCENARIOS[(SCENARIOS.indexOf(first) + 1) % 4]] : [first];
      for (const [k, s] of scen.entries()) {
        await db.insert(subAlerts).values({ caseId: row.id, subAlertNumber: `${row.alertNumber}-0${k + 1}`, scenario: s, sourceRef: "Synthetic history" });
      }
      summary.historyCases++;
    }
  }
  return summary;
}
