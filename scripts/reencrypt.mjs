// Move every stored secret from the old APP_SECRET to the new one (#244). Runs inside the app container:
//   docker compose exec app node scripts/reencrypt.mjs
// Order: in .env set APP_SECRET to the new value and APP_SECRET_PREVIOUS to the old one, restart the app
// (it reads with either key meanwhile), run this, then remove APP_SECRET_PREVIOUS and restart again. Safe to run twice: values already on the new key are skipped.
// Prints counts only, never values. Same format as src/lib/secrets.ts, repeated here because scripts
// run without the app's build.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const keyOf = (s) => createHash("sha256").update(s).digest();
const now = process.env.APP_SECRET || "";
const old = process.env.APP_SECRET_PREVIOUS || "";
if (now.length < 32 || old.length < 32) {
  console.error("Set APP_SECRET (new) and APP_SECRET_PREVIOUS (old), both 32+ characters.");
  process.exit(1);
}
const NEW = keyOf(now);
const OLD = keyOf(old);

function open(blob, k) {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1") throw new Error("Unknown secret format");
  const authTag = Buffer.from(tag, "base64");
  if (authTag.length !== 16) throw new Error("Bad secret tag");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"), { authTagLength: 16 });
  d.setAuthTag(authTag);
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

function seal(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", NEW, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

/** "kept" if already on the new key, the re-sealed blob if it was on the old one, "bad" if neither opens it. */
function move(blob) {
  try {
    open(blob, NEW);
    return "kept";
  } catch {}
  try {
    return seal(open(blob, OLD));
  } catch {
    return "bad";
  }
}

const tally = { moved: 0, kept: 0, bad: 0 };
const count = (r) => (r === "kept" || r === "bad" ? tally[r]++ : tally.moved++);
const SECRET_FIELDS = { ai: ["apiKey"], search: ["braveKey"] };

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
await sql.begin(async (tx) => {
  for (const [name, fields] of Object.entries(SECRET_FIELDS)) {
    const [row] = await tx`select value from app_settings where key = ${name} for update`;
    if (!row) continue;
    const value = { ...row.value };
    let changed = false;
    for (const f of fields) {
      if (typeof value[f] !== "string" || !value[f]) continue;
      const r = move(value[f]);
      count(r);
      if (r !== "kept" && r !== "bad") {
        value[f] = r;
        changed = true;
      }
    }
    if (changed) await tx`update app_settings set value = ${tx.json(value)}, updated_at = now() where key = ${name}`;
  }
  const rows = await tx`select user_id, eeo from profiles where eeo is not null for update`;
  for (const p of rows) {
    const r = move(p.eeo);
    count(r);
    if (r !== "kept" && r !== "bad") await tx`update profiles set eeo = ${r} where user_id = ${p.user_id}`;
  }
});
await sql.end();
console.log(`Re-encrypted ${tally.moved}, already on the new key ${tally.kept}, unreadable with either key ${tally.bad}.`);
if (tally.bad) console.log("Unreadable values were left as they are: re-enter API keys on the admin page; EEO answers need re-entering by that person.");
