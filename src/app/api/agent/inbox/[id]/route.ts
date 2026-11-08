import { z } from "zod";
import { body, HttpError, json } from "@/lib/api";
import { agentRoute } from "@/lib/agentAuth";
import { triageInbound } from "@/lib/inbound";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  status: z.enum(["triaged", "ignored"]).default("triaged"),
  kind: z.enum(["recruiter", "invitee", "user", "vendor", "spam", "other"]),
  summary: z.string().min(1).max(1000),
  applicationId: z.string().uuid().nullish(),
  draftReply: z.string().max(5000).nullish(),
  by: z.string().min(1).max(80),
});

/** POST the agent's read of one email: what it is, a summary, the application it belongs to, a reply draft for Eric (#178). Nothing is sent from here. */
export const POST = agentRoute<Ctx>(async (req, { params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  const { status, ...triage } = await body(req, Body);
  if (!(await triageInbound(id, status, triage))) throw new HttpError(404, "Not found");
  return json({ ok: true });
});
