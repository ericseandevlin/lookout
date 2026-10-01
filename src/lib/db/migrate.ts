import { migrate as run } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { db } from "./index";

export async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error("Missing required env var DATABASE_URL");
  await run(db, { migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR || "./drizzle") });
}
