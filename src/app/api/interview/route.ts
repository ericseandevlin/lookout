import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { featureOn } from "@/lib/features";
import { rateLimit } from "@/lib/ratelimit";
import { act, earlierTurns, interviewView, openInterview } from "@/lib/interview/session";

/** The interview (#1449): the conversation so far and the waiting question. Behind FEATURE_INTERVIEW. */
const gate = () => {
  if (!featureOn("INTERVIEW")) throw new HttpError(404, "Not found");
};

const Uuid = z.string().uuid();

/** GET: the page. GET ?earlier=1[&before=<turn id>]: one page of Earlier answers, older than that turn. */
export const GET = authed(async (req, { user }) => {
  gate();
  const q = new URL(req.url).searchParams;
  if (q.get("earlier")) {
    const before = q.get("before");
    if (before && !Uuid.safeParse(before).success) throw new HttpError(400, "Bad turn id");
    return json(await earlierTurns(user.id, before || null));
  }
  // ?app=<id>: opened from that application's keywords, so its missing keywords come first (#1485).
  const app = q.get("app");
  return json(await openInterview(user.id, app && Uuid.safeParse(app).success ? app : undefined));
});

const Input = z.object({
  turnId: z.string().uuid(),
  // "not_applicable" is from before Skip and Doesn't apply were merged; it saves as a skip.
  action: z.enum(["answer", "skip", "not_applicable"]).transform((a) => (a === "not_applicable" ? "skip" : a)),
  text: z.string().max(4000).default(""),
  app: z.string().uuid().optional(),
});

export const POST = authed(async (req, { user }) => {
  gate();
  const p = await body(req, Input);
  // Each answer is one model call; a person typing fast stays far under this.
  if (!(await rateLimit(`interview:${user.id}`, 30, 10 * 60_000))) throw new HttpError(429, "That's a lot of answers in a few minutes. Take a short break and come back.");
  const { note } = await act(user.id, p.turnId, p.action, p.text, p.app);
  return json(await interviewView(user.id, note));
});
