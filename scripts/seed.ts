/* Idempotent seed: demo users, default config and dashboard history. Never overwrites existing rows. */
import "./load-env";
import { databaseUrl, getDbForEnv } from "../lib/db/client";
import { seedDatabase } from "../lib/seed/run";

async function main() {
  if (process.env.VERCEL && !databaseUrl()) {
    console.warn("WARNING: no Postgres connection string found. Skipping the seed.");
    process.exit(0);
  }
  const db = await getDbForEnv();
  const summary = await seedDatabase(db, { password: process.env.SEED_USER_PASSWORD });
  console.log(`Seed complete: ${JSON.stringify(summary)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`Seed failed: ${err instanceof Error ? err.message : err}`);
  // On Vercel a failed demo seed must not block the deployment; locally it is an error.
  process.exit(process.env.VERCEL ? 0 : 1);
});
