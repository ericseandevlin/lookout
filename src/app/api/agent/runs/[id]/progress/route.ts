import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { body, HttpError, json } from "@/lib/api";
import { agentRoute } from "@/lib/agentAuth";
import { db, schema } from "@/lib/db";
import { progress } from "@/lib/ai/runs";

const Input = z.object({ pct: z.number().min(0).max(100), step: z.string().min(1).max(200) });
type Ctx = { params: Promise<{ id: string }> };

export const POST = agentRoute<Ctx>(async (req, { params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const p = await body(req, Input);
  const [run] = await db.select({ id: schema.runs.id }).from(schema.runs).where(and(eq(schema.runs.id, id), eq(schema.runs.status, "running")));
  if (!run) throw new HttpError(409, "That job isn't running");
  await progress(id, Math.min(p.pct, 99), p.step);
  return json({ ok: true });
});
