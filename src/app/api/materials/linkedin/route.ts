import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

const Input = z.object({
  handle: z
    .string()
    .trim()
    .max(100)
    .transform((s) => s.replace(/^(https?:\/\/)?(www\.)?linkedin\.com\/in\//i, "").replace(/\/+$/, "")),
  /** "Scan" marks the profile as linked. LinkedIn blocks automated reads, so the URL is passed to the agent as context. */
  scan: z.boolean().optional(),
});

export const PUT = authed(async (req, { user }) => {
  const { handle, scan } = await body(req, Input);
  const where = and(eq(schema.materials.userId, user.id), eq(schema.materials.kind, "linkedin"));
  const [existing] = await db.select().from(schema.materials).where(where);
  if (!handle) {
    if (existing) await db.delete(schema.materials).where(eq(schema.materials.id, existing.id));
    return json({ ok: true });
  }
  const scannedAt = scan ? new Date() : existing && existing.url === handle ? existing.scannedAt : null;
  if (existing) await db.update(schema.materials).set({ url: handle, scannedAt }).where(eq(schema.materials.id, existing.id));
  else await db.insert(schema.materials).values({ userId: user.id, kind: "linkedin", url: handle, scannedAt });
  return json({ ok: true, linked: !!scannedAt });
});
