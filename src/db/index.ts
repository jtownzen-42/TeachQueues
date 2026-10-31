import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { resolveDatabaseUrl } from "./url";

// node-postgres works with Neon (TLS via ?sslmode=require) and supports
// interactive transactions, which the refresh-token row lock needs.
const globalForDb = globalThis as unknown as { tqPool?: Pool };

function pool(): Pool {
  if (!globalForDb.tqPool) {
    const url = resolveDatabaseUrl();
    if (!url) throw new Error("No Postgres URL env var found (DATABASE_URL or a Neon-integration variant)");
    globalForDb.tqPool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  }
  return globalForDb.tqPool;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getDb() {
  if (!_db) _db = drizzle(pool(), { schema });
  return _db;
}
export type Db = ReturnType<typeof getDb>;
