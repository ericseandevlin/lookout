import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

const root = () => path.resolve(env.dataDir, "uploads");

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type FileType = { ext: "pdf" | "docx"; mime: string };

/** Identify by magic bytes, not by the client's claimed type. */
export function sniff(buf: Buffer, name: string): FileType | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", mime: "application/pdf" };
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip && /\.docx$/i.test(name))
    return { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  return null;
}

export async function saveUserFile(userId: string, buf: Buffer, ext: string) {
  const dir = path.join(root(), userId);
  await mkdir(dir, { recursive: true });
  const key = `${userId}/${randomUUID()}.${ext}`;
  await writeFile(path.join(root(), key), buf, { mode: 0o600 });
  return key;
}

function resolveKey(key: string) {
  const p = path.resolve(root(), key);
  if (!p.startsWith(root() + path.sep)) throw new Error("Bad file key");
  return p;
}

export const readUserFile = (key: string) => readFile(resolveKey(key));
export const deleteUserFile = (key: string) => rm(resolveKey(key), { force: true });
export const deleteUserFiles = (userId: string) => rm(path.join(root(), userId), { recursive: true, force: true });
