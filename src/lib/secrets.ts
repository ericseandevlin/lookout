import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM with a key derived from APP_SECRET. Used for API keys stored in app_settings and EEO answers.
// During a rotation APP_SECRET_PREVIOUS holds the old secret: reads fall back to it until
// scripts/reencrypt.mjs has moved every stored value to the new one (#244).
function key() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be set (32+ chars) to store secrets");
  return createHash("sha256").update(s).digest();
}

function previousKey() {
  const s = process.env.APP_SECRET_PREVIOUS;
  return s && s.length >= 32 ? createHash("sha256").update(s).digest() : null;
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

function open(blob: string, k: Buffer) {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1") throw new Error("Unknown secret format");
  const authTag = Buffer.from(tag, "base64");
  // Pin the tag length so a truncated tag can't pass authentication.
  if (authTag.length !== 16) throw new Error("Bad secret tag");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"), { authTagLength: 16 });
  d.setAuthTag(authTag);
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export function decrypt(blob: string) {
  try {
    return open(blob, key());
  } catch (e) {
    const old = previousKey();
    if (!old) throw e;
    return open(blob, old);
  }
}

// Files on disk (#16): "LKE1" + 12-byte IV + 16-byte tag + ciphertext, same keys as above.
const FILE_MAGIC = Buffer.from("LKE1");

export const isSealedFile = (buf: Buffer) => buf.length >= 32 && buf.subarray(0, 4).equals(FILE_MAGIC);

export function sealFile(plain: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([FILE_MAGIC, iv, c.getAuthTag(), data]);
}

function openFileWith(buf: Buffer, k: Buffer) {
  const d = createDecipheriv("aes-256-gcm", k, buf.subarray(4, 16), { authTagLength: 16 });
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

/** Decrypt a sealed file. Files saved before #16 are plain and come back as they are. */
export function openFile(buf: Buffer) {
  if (!isSealedFile(buf)) return buf;
  try {
    return openFileWith(buf, key());
  } catch (e) {
    const old = previousKey();
    if (!old) throw e;
    return openFileWith(buf, old);
  }
}

/** Show only enough of a secret to recognize it. */
export const mask = (s: string) => (s ? `${s.slice(0, 4)}…${s.slice(-4)}` : "");
