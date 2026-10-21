import { and, eq } from "drizzle-orm";
import { authed, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { deleteUserFile, MAX_UPLOAD_BYTES, readUserFile, saveUserFile, sniff } from "@/lib/files";
import { rateLimit } from "@/lib/ratelimit";
import { extractResumeText } from "@/lib/agent/resume";

/**
 * LinkedIn blocks automated reads and its API doesn't share work history, so
 * people save their profile as a PDF (Resources > Save to PDF) and upload it.
 * The text rides along with the resume on every search.
 */
const linkedinOf = (userId: string) =>
  db
    .select()
    .from(schema.materials)
    .where(and(eq(schema.materials.userId, userId), eq(schema.materials.kind, "linkedin")))
    .then((r) => r[0]);

export const POST = authed(async (req, { user }) => {
  if (!await rateLimit(`linkedin-pdf:${user.id}`, 10, 24 * 3600_000)) throw new HttpError(429, "Upload limit reached for today.");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Files must be under 5 MB.");
  const buf = Buffer.from(await file.arrayBuffer());
  if (sniff(buf, file.name)?.ext !== "pdf") throw new HttpError(415, "Upload the PDF that LinkedIn's Save to PDF gives you.");
  const text = (await extractResumeText(buf, "application/pdf").catch(() => "")).trim();
  if (text.length < 200) throw new HttpError(422, "Couldn't read any text in that PDF. Use LinkedIn's Save to PDF, not a screenshot or a print.");
  const key = await saveUserFile(user.id, buf, "pdf");
  const name = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  const uploadedAt = new Date().toISOString();
  const old = await linkedinOf(user.id);
  const values = { fileKey: key, fileName: name, mime: "application/pdf", extracted: { text: text.slice(0, 20000), uploadedAt } };
  if (old) {
    await db.update(schema.materials).set(values).where(eq(schema.materials.id, old.id));
    if (old.fileKey) await deleteUserFile(old.fileKey);
  } else {
    await db.insert(schema.materials).values({ userId: user.id, kind: "linkedin", ...values });
  }
  return json({ pdf: { name, uploadedAt } });
});

export const GET = authed(async (_req, { user }) => {
  const r = await linkedinOf(user.id);
  if (!r?.fileKey) throw new HttpError(404, "No LinkedIn PDF");
  const buf = await readUserFile(r.fileKey);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${r.fileName ?? "linkedin.pdf"}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "cache-control": "private, no-store",
    },
  });
});

export const DELETE = authed(async (_req, { user }) => {
  const r = await linkedinOf(user.id);
  if (r?.fileKey) {
    await deleteUserFile(r.fileKey);
    if (r.url) await db.update(schema.materials).set({ fileKey: null, fileName: null, mime: null, extracted: null }).where(eq(schema.materials.id, r.id));
    else await db.delete(schema.materials).where(eq(schema.materials.id, r.id));
  }
  return json({ ok: true });
});
