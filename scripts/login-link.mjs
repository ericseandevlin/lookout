// Mint a one-time sign-in link without email. Runs inside the app container:
//   docker compose exec app node scripts/login-link.mjs someone@example.com
// Creates nothing by itself; the account is created when the link is used (subject to SIGNUP_MODE).
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!/^\S+@\S+\.\S+$/.test(email)) {
  console.error("usage: node scripts/login-link.mjs <email>");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");
await sql`insert into login_tokens (token_hash, email, expires_at) values (${hash}, ${email}, now() + interval '60 minutes')`;
console.log(`${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/auth/verify?token=${token}`);
console.log("Works once, expires in 60 minutes.");
await sql.end();
