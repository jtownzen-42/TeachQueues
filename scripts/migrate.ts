// Run Drizzle migrations against DATABASE_URL (Neon). Usage: npm run db:migrate
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    const { rows } = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    console.log(`Migrations applied. Journal entries: ${rows[0].n}`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error("Migration failed:", e.message); process.exit(1); });
