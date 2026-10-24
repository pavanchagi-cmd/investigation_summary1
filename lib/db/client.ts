import path from "node:path";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/** Both drivers expose the same query-builder API; we type against postgres-js. */
export type Db = PostgresJsDatabase<typeof schema>;

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

const nonEmpty = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** Env keys that hold a pooled/unpooled URL, including integrations created with a custom prefix (e.g. MYDB_DATABASE_URL). */
function findUrl(exact: string[], suffixes: string[]): string | undefined {
  for (const k of exact) if (nonEmpty(process.env[k])) return nonEmpty(process.env[k]);
  for (const [k, v] of Object.entries(process.env)) {
    if (suffixes.some((s) => k.endsWith(s)) && nonEmpty(v)) return nonEmpty(v);
  }
  return undefined;
}

/**
 * Postgres connection string for the app. Vercel's Neon integration sets DATABASE_URL (or
 * POSTGRES_URL, or <PREFIX>_DATABASE_URL when a custom prefix was chosen).
 */
export function databaseUrl(): string | undefined {
  return findUrl(["DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"], ["_DATABASE_URL", "_POSTGRES_URL"]);
}

/** Direct (unpooled) connection for migrations when the integration provides one. */
export function migrationUrl(): string | undefined {
  return (
    findUrl(["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"], ["_DATABASE_URL_UNPOOLED", "_POSTGRES_URL_NON_POOLING"]) ?? databaseUrl()
  );
}

/**
 * Connects to Postgres when a URL is configured. Otherwise opens an embedded PGlite database in
 * `.data/pglite` (local dev, CI and e2e only) and applies migrations on first use.
 */
export async function getDbForEnv(): Promise<Db> {
  const url = databaseUrl();
  if (url) {
    const { default: postgres } = await import("postgres");
    const client = postgres(url, { max: 5, prepare: false });
    return drizzlePg(client, { schema, casing: "snake_case" });
  }
  if (process.env.VERCEL) {
    throw new Error("DATABASE_URL is not set. Connect a Postgres database in the Vercel project's Storage tab.");
  }
  return openPglite(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
}

export async function openPglite(dataDir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}
