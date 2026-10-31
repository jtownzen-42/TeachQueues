// Offline check: apply all migrations to an in-memory Postgres (PGlite).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

async function main() {
const client = new PGlite();
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
const r = await client.query<{ column_name: string }>(
  "select column_name from information_schema.columns where table_name='users' order by ordinal_position");
console.log("users columns:", r.rows.map((x) => x.column_name).join(", "));
const t = await client.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' order by 1");
console.log("tables:", t.rows.map((x) => x.table_name).join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });
