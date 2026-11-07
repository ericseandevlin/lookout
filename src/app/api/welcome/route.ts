import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { track } from "@/lib/eventStore";
import { OLD_SALARY_KEYS, SALARY_RANGES, salaryRange, WORK_MODES } from "@/lib/onboarding";

const Input = z.object({
  name: z.string().trim().min(1).max(120),
  salary: z.enum([...SALARY_RANGES.map((r) => r.key), ...Object.keys(OLD_SALARY_KEYS)] as [string, ...string[]]).optional(),
  mode: z.enum(WORK_MODES).optional(),
});

/** Welcome step: name plus two quick picks that pre-fill profile questions 2 and 3 (job only, #8). */
export const POST = authed(async (req, { user }) => {
  const p = await body(req, Input);
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const answers = { ...(profile?.answers ?? {}) };
  if ((profile?.kind ?? "job") === "job") {
    const range = salaryRange(p.salary);
    if (range) Object.assign(answers, { floor: range.floor, target: range.target });
    if (p.mode) answers.modes = [p.mode];
  }
  await db.update(schema.profiles).set({ answers, updatedAt: new Date() }).where(eq(schema.profiles.userId, user.id));
  await db.update(schema.users).set({ name: p.name, onboardedAt: new Date() }).where(eq(schema.users.id, user.id));
  await track(user.id, "welcome_done");
  return json({ ok: true });
});
