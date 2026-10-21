import { and, eq } from "drizzle-orm";
import { authed, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { deleteUserFile, MAX_UPLOAD_BYTES, readUserFile, saveUserFile, sniff } from "@/lib/files";
import { rateLimit } from "@/lib/ratelimit";
import { scanResume } from "@/lib/agent/resume";
import { toResume } from "@/lib/state";

const resumeOf = (userId: string) =>
  db
    .select()
    .from(schema.materials)
    .where(and(eq(schema.materials.userId, userId), eq(schema.materials.kind, "resume")))
    .then((r) => r[0]);

export const POST = authed(async (req, { user }) => {
  if (!await rateLimit(`resume:${user.id}`, 10, 24 * 3600_000)) throw new HttpError(429, "Upload limit reached for today.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Files must be under 5 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  const type = sniff(buf, file.name);
  if (!type) throw new HttpError(415, "Upload a PDF or DOCX.");
  const key = await saveUserFile(user.id, buf, type.ext);
  const old = await resumeOf(user.id);
  const name = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  const [row] = await db
    .insert(schema.materials)
    .values({ userId: user.id, kind: "resume", fileKey: key, fileName: name, mime: type.mime, status: "scanning" })
    .returning();
  if (old) {
    await db.delete(schema.materials).where(eq(schema.materials.id, old.id));
    if (old.fileKey) await deleteUserFile(old.fileKey);
  }
  // Scan in the background; the client polls /api/state for the result.
  void scanResume(user.id, row.id).catch((e) => console.error("resume scan failed", e));
  return json({ resume: toResume(row) });
});

export const GET = authed(async (_req, { user }) => {
  const r = await resumeOf(user.id);
  if (!r?.fileKey) throw new HttpError(404, "No resume");
  const buf = await readUserFile(r.fileKey);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": r.mime ?? "application/octet-stream",
      "content-disposition": `${r.mime === "application/pdf" ? "inline" : "attachment"}; filename="${r.fileName ?? "resume"}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, no-store",
    },
  });
});

export const DELETE = authed(async (_req, { user }) => {
  const r = await resumeOf(user.id);
  if (r) {
    await db.delete(schema.materials).where(eq(schema.materials.id, r.id));
    if (r.fileKey) await deleteUserFile(r.fileKey);
  }
  return json({ ok: true });
});
