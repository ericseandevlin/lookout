import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { HttpError, json } from "@/lib/api";

/**
 * Server-to-server routes for the external search agent. Bearer AGENT_TOKEN,
 * compared in constant time. No cookies, so no origin check.
 */
export function agentRoute<C = object>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      const want = process.env.AGENT_TOKEN ?? "";
      const got = ((await headers()).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const ok = want.length >= 32 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
      if (!ok) throw new HttpError(401, "Bad agent token");
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      if (e instanceof z.ZodError) return json({ error: "Invalid input", issues: e.issues.slice(0, 10) }, { status: 400 });
      console.error("[agent api]", e);
      return json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}
