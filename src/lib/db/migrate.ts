import { migrate as run } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { db } from "./index";

export async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error("Missing required env var DATABASE_URL");
  // The ignore hint keeps the build's file trace from pulling in the whole repo (#426); the Dockerfile copies drizzle/ itself.
  await run(db, { migrationsFolder: path.resolve(/*turbopackIgnore: true*/ process.env.MIGRATIONS_DIR || "./drizzle") });
}
