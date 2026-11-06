// Bring every stored secret and uploaded file onto the current APP_SECRET (#244, #16). Runs inside the app container:
//   docker compose exec app node scripts/reencrypt.mjs
// Rotation: in .env set APP_SECRET to the new value and APP_SECRET_PREVIOUS to the old one, restart the app
// (it reads with either key meanwhile), run this, then remove APP_SECRET_PREVIOUS and restart again.
// Without APP_SECRET_PREVIOUS it only encrypts uploads saved before #16. Safe to run twice: values already
// on the current key are skipped.
// Prints counts only, never values. Same format as src/lib/secrets.ts, repeated here because scripts
// run without the app's build.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const keyOf = (s) => createHash("sha256").update(s).digest();
const now = process.env.APP_SECRET || "";
const old = process.env.APP_SECRET_PREVIOUS || "";
if (now.length < 32 || (old && old.length < 32)) {
  console.error("APP_SECRET (and APP_SECRET_PREVIOUS, if set) must be 32+ characters.");
  process.exit(1);
}
const NEW = keyOf(now);
const OLD = old ? keyOf(old) : null;

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
    if (!OLD) return "bad";
    return seal(open(blob, OLD));
  } catch {
    return "bad";
  }
}

// Files: "LKE1" + 12-byte IV + 16-byte tag + ciphertext, as in src/lib/secrets.ts.
const MAGIC = Buffer.from("LKE1");
function openFile(buf, k) {
  const d = createDecipheriv("aes-256-gcm", k, buf.subarray(4, 16), { authTagLength: 16 });
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}
function sealFile(plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", NEW, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), data]);
}
/** null if already on the new key, the sealed bytes to write, or "bad". Plain files (before #16) get sealed. */
function moveFile(buf) {
  if (!(buf.length >= 32 && buf.subarray(0, 4).equals(MAGIC))) return sealFile(buf);
  try {
    openFile(buf, NEW);
    return null;
  } catch {}
  try {
    if (!OLD) return "bad";
    return sealFile(openFile(buf, OLD));
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

const files = { moved: 0, kept: 0, bad: 0 };
const uploads = path.resolve(process.env.DATA_DIR || "./data", "uploads");
const users = await readdir(uploads, { withFileTypes: true }).catch(() => []);
for (const u of users.filter((d) => d.isDirectory())) {
  for (const f of await readdir(path.join(uploads, u.name), { withFileTypes: true })) {
    if (!f.isFile() || f.name.endsWith(".tmp")) continue;
    const p = path.join(uploads, u.name, f.name);
    const r = moveFile(await readFile(p));
    if (r === null) files.kept++;
    else if (r === "bad") files.bad++;
    else {
      // Write next to it, then rename, so a crash never leaves a half-written file.
      await writeFile(`${p}.tmp`, r, { mode: 0o600 });
      await rename(`${p}.tmp`, p);
      files.moved++;
    }
  }
}

console.log(`Secrets: re-encrypted ${tally.moved}, already on the current key ${tally.kept}, unreadable ${tally.bad}.`);
console.log(`Uploads: encrypted ${files.moved}, already on the current key ${files.kept}, unreadable ${files.bad}.`);
if (tally.bad) console.log("Unreadable secrets were left as they are: re-enter API keys on the admin page; EEO answers need re-entering by that person.");
if (files.bad) console.log("Unreadable uploads were left as they are. If a rotation is under way, set APP_SECRET_PREVIOUS and run again; otherwise those people need to upload again.");
