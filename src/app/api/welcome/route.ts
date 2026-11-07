import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { track } from "@/lib/eventStore";
import { OLD_SALARY_KEYS, SALARY_RANGES, salaryRange, WORK_MODES } from "@/lib/onboarding";
import { getActiveSearch } from "@/lib/searches";

const Input = z.object({
  name: z.string().trim().min(1).max(120),
  salary: z.enum([...SALARY_RANGES.map((r) => r.key), ...Object.keys(OLD_SALARY_KEYS)] as [string, ...string[]]).optional(),
  mode: z.enum(WORK_MODES).optional(),
});

/** Welcome step: name plus two quick picks that pre-fill profile questions 2 and 3 (job only, #8). */
export const POST = authed(async (req, { user }) => {
  const p = await body(req, Input);
  const search = await getActiveSearch(user.id);
  if (!search) throw new HttpError(409, "Create a search first.");
  const answers = { ...search.answers };
  if (search.kind === "job") {
    const range = salaryRange(p.salary);
    if (range) Object.assign(answers, { floor: range.floor, target: range.target });
    if (p.mode) answers.modes = [p.mode];
  }
  await db.update(schema.searches).set({ answers, updatedAt: new Date() }).where(eq(schema.searches.id, search.id));
  await db.update(schema.users).set({ name: p.name, onboardedAt: new Date() }).where(eq(schema.users.id, user.id));
  await track(user.id, "welcome_done");
  return json({ ok: true });
});
