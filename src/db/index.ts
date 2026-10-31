import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// node-postgres works with Neon (TLS via ?sslmode=require) and supports
// interactive transactions, which the refresh-token row lock needs.
const globalForDb = globalThis as unknown as { tqPool?: Pool };

function pool(): Pool {
  if (!globalForDb.tqPool) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("Missing required env var DATABASE_URL");
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
