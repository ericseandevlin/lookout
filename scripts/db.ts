// DB handle for CLI scripts (the app's lib/db is server-only).
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
export const sql = postgres(process.env.DATABASE_URL, { max: 2 });
export const db = drizzle(sql, { schema });
export { schema };
