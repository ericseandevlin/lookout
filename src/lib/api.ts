import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { env } from "@/lib/env";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

/** Reject cross-site writes. Cookies are SameSite=Lax; this closes the remaining gaps. */
async function assertSameOrigin(method: string) {
  if (method === "GET" || method === "HEAD") return;
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) throw new HttpError(403, "Missing origin");
  const extra = (process.env.EXTRA_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  const allowed = new Set([env.appUrl, `http://localhost:${process.env.PORT || 3000}`, ...extra]);
  if (!allowed.has(origin)) throw new HttpError(403, "Bad origin");
}

type Handler<C> = (req: Request, ctx: C & { user: SessionUser }) => Promise<Response>;

/** Wrap a route handler: same-origin check, session required, uniform errors. */
export function authed<C = object>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      await assertSameOrigin(req.method);
      const user = await getSessionUser();
      if (!user) throw new HttpError(401, "Sign in required");
      return await fn(req, { ...ctx, user });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function publicRoute<C = object>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      await assertSameOrigin(req.method);
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) return json({ error: "Invalid input", issues: e.issues }, { status: 400 });
  console.error(e);
  return json({ error: "Something went wrong" }, { status: 500 });
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const data = await req.json().catch(() => {
    throw new HttpError(400, "Expected JSON");
  });
  return schema.parse(data);
}

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

/** Like authed, but only for admins. */
export function adminRoute<C = object>(fn: Handler<C>) {
  return authed<C>(async (req, ctx) => {
    const { isAdmin } = await import("@/lib/users");
    if (!isAdmin(ctx.user)) throw new HttpError(403, "Admins only");
    return fn(req, ctx);
  });
}
