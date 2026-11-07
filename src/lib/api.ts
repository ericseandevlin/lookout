import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { env } from "@/lib/env";
import { getSessionUser, refreshSession, type SessionUser } from "@/lib/auth/session";
import { AiConfigError } from "@/lib/ai/llm";
import { BudgetError } from "@/lib/ai/runs";
import { SearchConfigError } from "@/lib/ai/search";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);

/**
 * Origins allowed to make cookie-carrying writes: the app's own, any in EXTRA_ORIGINS, and in
 * development only, localhost. Production never trusts localhost (#209).
 */
export function allowedOrigins(appUrl: string, e: { NODE_ENV?: string; PORT?: string; EXTRA_ORIGINS?: string } = process.env) {
  const extra = (e.EXTRA_ORIGINS || "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean);
  return new Set([appUrl, ...(e.NODE_ENV === "production" ? [] : [`http://localhost:${e.PORT || 3000}`]), ...extra]);
}

/** Reject cross-site writes. Cookies are SameSite=Lax; this closes the remaining gaps. */
async function assertSameOrigin(method: string) {
  if (method === "GET" || method === "HEAD") return;
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) throw new HttpError(403, "Missing origin");
  if (!allowedOrigins(env.appUrl).has(origin)) throw new HttpError(403, "Bad origin");
}

type Handler<C> = (req: Request, ctx: C & { user: SessionUser }) => Promise<Response>;

/** Wrap a route handler: same-origin check, session required, uniform errors. */
export function authed<C = object>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      await assertSameOrigin(req.method);
      const user = await getSessionUser();
      if (!user) throw new HttpError(401, "Sign in required");
      await refreshSession();
      return await fn(req, { ...ctx, user });
    } catch (e) {
      return errorResponse(e, req);
    }
  };
}

export function publicRoute<C = object>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      await assertSameOrigin(req.method);
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e, req);
    }
  };
}

export function errorResponse(e: unknown, req?: Request) {
  if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
  // Known limits, not crashes: say what happened instead of "Something went wrong" (#201).
  if (e instanceof BudgetError) return json({ error: e.message }, { status: 429 });
  if (e instanceof AiConfigError || e instanceof SearchConfigError) return json({ error: e.message }, { status: 503 });
  if (e instanceof z.ZodError) return json({ error: "Invalid input", issues: e.issues }, { status: 400 });
  console.error(e);
  // Kept for Admin > Errors (#12). Imported late so modules that only need HttpError don't load the database.
  void import("@/lib/errorLog").then((m) => m.recordError("route", e, { path: req && new URL(req.url).pathname, method: req?.method })).catch(() => {});
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
