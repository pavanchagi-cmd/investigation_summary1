import path from "node:path";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/** Both drivers expose the same query-builder API; we type against postgres-js. */
export type Db = PostgresJsDatabase<typeof schema>;

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/**
 * Connects to DATABASE_URL when set. Otherwise opens an embedded PGlite database in
 * `.data/pglite` (local dev, CI and e2e only) and applies migrations on first use.
 */
export async function getDbForEnv(): Promise<Db> {
  const url = process.env.DATABASE_URL;
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
