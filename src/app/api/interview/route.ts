import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { featureOn } from "@/lib/features";
import { rateLimit } from "@/lib/ratelimit";
import { act, interviewView, openInterview } from "@/lib/interview/session";

/** The interview (#1449): the conversation so far and the waiting question. Behind FEATURE_INTERVIEW. */
const gate = () => {
  if (!featureOn("INTERVIEW")) throw new HttpError(404, "Not found");
};

export const GET = authed(async (_req, { user }) => {
  gate();
  return json(await openInterview(user.id));
});

const Input = z.object({
  turnId: z.string().uuid(),
  action: z.enum(["answer", "skip", "not_applicable"]),
  text: z.string().max(4000).default(""),
});

export const POST = authed(async (req, { user }) => {
  gate();
  const p = await body(req, Input);
  // Each answer is one model call; a person typing fast stays far under this.
  if (!(await rateLimit(`interview:${user.id}`, 30, 10 * 60_000))) throw new HttpError(429, "That's a lot of answers in a few minutes. Take a short break and come back.");
  const { note } = await act(user.id, p.turnId, p.action, p.text);
  return json(await interviewView(user.id, note));
});
