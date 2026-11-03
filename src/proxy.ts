import { NextResponse, type NextRequest } from "next/server";
import { newNonce, pageCsp } from "@/lib/csp";

const GATED = /^\/(finds|profile|settings|admin)(\/|$)/;

/**
 * Every page gets a fresh CSP nonce (#14). Pages behind sign-in also get an optimistic gate: real
 * session checks happen in the layout and API routes.
 */
export function proxy(req: NextRequest) {
  if (GATED.test(req.nextUrl.pathname) && !req.cookies.has("lookout_session")) return NextResponse.redirect(new URL("/", req.url));
  // Dev runs without a CSP, as before: React's dev build needs eval.
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  const nonce = newNonce();
  const csp = pageCsp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|ext/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
