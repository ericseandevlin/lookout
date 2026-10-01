import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// The URL is read lazily so `next build` works without one; migrate() asserts it at startup.
const globalForDb = globalThis as unknown as { lookoutSql?: postgres.Sql };

export const sqlClient = globalForDb.lookoutSql ?? postgres(process.env.DATABASE_URL ?? "", { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.lookoutSql = sqlClient;

export const db = drizzle(sqlClient, { schema });
export { schema };
