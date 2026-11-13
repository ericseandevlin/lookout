import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { track } from "@/lib/eventStore";

const Day = z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const Input = z.object({
  freq: z.enum(["Weekly", "Twice a week", "Daily"]).optional(),
  day: Day.optional(),
  days: z.array(Day).min(1).max(2).optional(),
  digest: z.boolean().optional(),
  density: z.enum(["Comfortable", "Compact"]).optional(),
  setup: z.enum(["Until complete", "Always", "Never"]).optional(),
  newDays: z.union([z.literal(3), z.literal(7), z.literal(14)]).optional(),
  railClosed: z.boolean().optional(),
});

export const PATCH = authed(async (req, { user }) => {
  const p = await body(req, Input);
  const set = {
    freq: p.freq,
    runDay: p.day,
    runDays: p.days,
    digest: p.digest,
    density: p.density,
    setupMode: p.setup,
    newDays: p.newDays,
    railClosed: p.railClosed,
  };
  const clean = Object.fromEntries(Object.entries(set).filter(([, v]) => v !== undefined));
  await db
    .insert(schema.settings)
    .values({ userId: user.id, ...clean })
    .onConflictDoUpdate({ target: schema.settings.userId, set: clean });
  // Which settings people find in their first week (#992). Opening or closing the sidebar isn't a choice about Lookout.
  for (const k of Object.keys(p) as (keyof typeof p)[]) if (k !== "railClosed" && p[k] !== undefined) await track(user.id, "settings_change", k);
  return json({ ok: true });
});
