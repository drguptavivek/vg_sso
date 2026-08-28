import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

type AdminDatabase = NodePgDatabase<typeof schema>;

const globalDatabase = globalThis as typeof globalThis & {
  adminConsolePool?: Pool;
  adminConsoleDb?: AdminDatabase;
};

export function adminDatabase(): AdminDatabase {
  if (globalDatabase.adminConsoleDb) return globalDatabase.adminConsoleDb;
  const connectionString = process.env.ADMIN_CONSOLE_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Missing required environment variable: ADMIN_CONSOLE_DATABASE_URL");
  const pool = new Pool({
    connectionString,
    max: Number(process.env.ADMIN_CONSOLE_DATABASE_POOL_MAX ?? "10"),
  });
  const db = drizzle(pool, { schema });
  globalDatabase.adminConsolePool = pool;
  globalDatabase.adminConsoleDb = db;
  return db;
}
