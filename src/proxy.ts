import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate only: real session checks happen in the layout and API routes.
export function proxy(req: NextRequest) {
  if (!req.cookies.has("lookout_session")) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/finds/:path*", "/profile/:path*", "/settings/:path*", "/admin/:path*"] };
