import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const connectionString = process.env.ADMIN_CONSOLE_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("Missing required environment variable: ADMIN_CONSOLE_DATABASE_URL");
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
    console.log("ADMIN-CONSOLE-DB: migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("ADMIN-CONSOLE-DB: migration failed", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
