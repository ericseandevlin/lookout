import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { db, schema } from "@/lib/db";
import { track } from "@/lib/eventStore";
import { acceptedNow } from "@/lib/legal";

const Input = z.object({ agree: z.literal(true) });

/** Agree to the current Terms and Privacy versions (#21): existing accounts, or after a version changes. */
export const POST = authed(async (req, { user }) => {
  await body(req, Input);
  await db.update(schema.users).set(acceptedNow()).where(eq(schema.users.id, user.id));
  await track(user.id, "consent_accepted");
  return json({ ok: true });
});
