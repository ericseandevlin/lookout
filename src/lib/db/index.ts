import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { lookoutSql?: postgres.Sql };

export const sqlClient = globalForDb.lookoutSql ?? postgres(env.databaseUrl, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.lookoutSql = sqlClient;

export const db = drizzle(sqlClient, { schema });
export { schema };
