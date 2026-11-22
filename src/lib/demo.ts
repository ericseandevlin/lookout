import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { DEMO_EMAIL, DEMO_NAME, seedDemo } from "../../scripts/demo-data";

/**
 * The public demo (#1317): the made-up Maya Ortiz account from the README screenshots, served read only at /demo
 * when FEATURE_DEMO=on. Seeded disabled, so nobody can sign in to it and no scheduled search spends money on it.
 */
export async function ensureDemo() {
  try {
    const { finds } = await seedDemo(db, DEMO_EMAIL, new Date(), { disabled: true });
    console.info(`demo: rebuilt ${DEMO_NAME} with ${finds} finds`);
  } catch (e) {
    console.error("demo: could not rebuild the demo account", e);
  }
}

/** The demo account, only if it is the seeded one: right email, right name, disabled. Anything else is not shown. */
export async function demoUser() {
  const [u] = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.email, DEMO_EMAIL), eq(schema.users.name, DEMO_NAME), eq(schema.users.disabled, true)));
  return u ?? null;
}
