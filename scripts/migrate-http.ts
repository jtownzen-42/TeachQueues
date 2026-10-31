// Same migrations as scripts/migrate.ts, but over Neon's HTTPS SQL endpoint (port 443).
// Use when outbound Postgres (5432) is blocked. Usage: npm run db:migrate:http
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { resolveDatabaseUrl } from "../src/db/url";

async function main() {
  const url = resolveDatabaseUrl();
  if (!url) throw new Error("No Postgres URL env var set (DATABASE_URL or a Neon-integration variant)");
  const sql = neon(url);
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  const rows = (await sql.query("select id, hash from drizzle.__drizzle_migrations order by id")) as { id: number; hash: string }[];
  console.log(`Migrations applied. Journal entries: ${rows.length}`);
}
main().catch((e) => { console.error("Migration failed:", String(e.message).replace(/postgres\S*/g, "<url>")); process.exit(1); });
