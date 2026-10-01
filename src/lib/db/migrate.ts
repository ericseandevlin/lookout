import { migrate as run } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { db } from "./index";

export async function migrate() {
  await run(db, { migrationsFolder: path.resolve(process.env.MIGRATIONS_DIR || "./drizzle") });
}
