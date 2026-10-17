import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { EEO_CATEGORIES, EEO_CHOICES } from "@/lib/application/eeo";
import { loadEeo, saveEeo } from "@/lib/application/eeoStore";

/** Voluntary EEO answers (#122): opt-in, encrypted, editable, deletable. Never sent to an AI model. */
export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { consent, profile } = await loadEeo(user.id);
  return json({ consent, answers: profile.answers, saved: Object.keys(profile.exact).length });
});

const Put = z.object({
  consent: z.boolean().optional(),
  answers: z.record(z.enum(EEO_CATEGORIES), z.string().max(80)).optional(),
});

export const PUT = authed(async (req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const p = await body(req, Put);
  const { profile } = await loadEeo(user.id);
  if (p.answers) {
    for (const [cat, v] of Object.entries(p.answers)) {
      const c = cat as keyof typeof EEO_CHOICES;
      if (v && !EEO_CHOICES[c].choices.includes(v)) throw new HttpError(400, `Pick one of the listed answers for ${EEO_CHOICES[c].label}`);
      if (v) profile.answers[c] = v;
      else delete profile.answers[c];
    }
  }
  await saveEeo(user.id, { profile: p.answers ? profile : undefined, consent: p.consent });
  const after = await loadEeo(user.id);
  return json({ consent: after.consent, answers: after.profile.answers, saved: Object.keys(after.profile.exact).length });
});

/** Forget every EEO answer and turn the permission off. */
export const DELETE = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  await saveEeo(user.id, { profile: null, consent: false });
  return json({ consent: false, answers: {}, saved: 0 });
});
