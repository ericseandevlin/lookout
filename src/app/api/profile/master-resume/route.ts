import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply, getAutoApplySettings } from "@/lib/apply";
import { emptyUsage } from "@/lib/ai/llm";
import { assertBudget } from "@/lib/ai/runs";
import { buildMaster, confirmMaster, discardMaster, getMaster } from "@/lib/application/master";
import { confirmedMaster, unplacedLines } from "@/lib/application/masterCheck";
import type { SessionUser as User } from "@/lib/auth/session";
import type { MasterResume } from "@/lib/db/schema";

/**
 * The master resume as Lookout reads it (#131): built from the upload when the person asks, checked
 * and confirmed by them once. Drafts read the confirmed version.
 */
async function view(user: User, m: MasterResume | null, stale = false) {
  const s = await getAutoApplySettings(user.id);
  const c = confirmedMaster(m);
  return json({
    md: m?.md ?? null,
    confirmed: !!c && c.md === m?.md,
    confirmedAt: c?.at ?? null,
    hasConfirmed: !!c,
    stale,
    at: m?.at ?? null,
    uncertain: m?.uncertain ?? [],
    unplaced: m?.md ? unplacedLines(m.md) : [],
    template: s.template ?? "modern",
    accent: s.accent ?? null,
  });
}

const allowed = (user: User) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
};

export const GET = authed(async (_req, { user }) => {
  allowed(user);
  const { master, stale } = await getMaster(user.id);
  return view(user, master, stale);
});

/** Build master resume: read the uploaded file once more into structure (one model call). */
export const POST = authed(async (_req, { user }) => {
  allowed(user);
  await assertBudget(user.id);
  const m = await buildMaster(user.id, emptyUsage());
  if (!m) throw new HttpError(400, "Add your resume above first.");
  return view(user, m);
});

/** Save and confirm: every new draft reads this version. */
export const PUT = authed(async (req, { user }) => {
  allowed(user);
  const { md } = await body(req, z.object({ md: z.string().trim().min(40).max(40000) }));
  const m = await confirmMaster(user.id, md);
  const { stale } = await getMaster(user.id);
  return view(user, m, stale);
});

/** Throw away an unconfirmed rebuild. The confirmed version stays as it was. */
export const DELETE = authed(async (_req, { user }) => {
  allowed(user);
  await discardMaster(user.id);
  const { master, stale } = await getMaster(user.id);
  return view(user, master, stale);
});
