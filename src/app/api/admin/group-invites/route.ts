import { z } from "zod";
import { adminRoute, body, HttpError, json } from "@/lib/api";
import { env } from "@/lib/env";
import { createGroupInvite, listGroupInvites } from "@/lib/groupInvite";

// Group invite links from the Admin page (#993), so making one for a class or meetup takes seconds, not SSH.

const Input = z.object({
  label: z.string().trim().min(1).max(80),
  code: z.string().trim().toLowerCase().max(40).optional(),
  max: z.number().int().min(1).max(500),
  days: z.number().int().min(1).max(90),
});

const withLink = <T extends { code: string }>(g: T) => ({ ...g, link: `${env.appUrl}/join/${g.code}` });

export const GET = adminRoute(async () => json({ groups: (await listGroupInvites()).map(withLink) }));

export const POST = adminRoute(async (req) => {
  const p = await body(req, Input);
  const r = await createGroupInvite({ ...p, code: p.code || undefined });
  if (!r.ok) throw new HttpError(r.status, r.error);
  return json(withLink(r.invite));
});
