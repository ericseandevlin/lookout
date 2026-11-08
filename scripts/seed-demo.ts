/**
 * Seed the made-up demo account from the README screenshots (#415), for a local board without an AI key.
 * Usage: npm run seed:demo [email]   (default demo@example.com; re-running rebuilds it)
 * Then sign in as it: node --env-file=.env.local scripts/login-link.mjs demo@example.com
 */
import { DEMO_EMAIL, seedDemo } from "./demo-data";
import { db, sql } from "./db";

const email = process.argv[2] || DEMO_EMAIL;
seedDemo(db, email)
  .then(({ finds }) => console.log(`seeded ${email}: Maya Ortiz with ${finds} finds. Sign in: node --env-file=.env.local scripts/login-link.mjs ${email}`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
