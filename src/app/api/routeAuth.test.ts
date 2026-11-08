import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every API handler must go through a wrapper that checks who is calling (#409). A bare
// `export async function POST` skips the session and same-origin checks, so it needs a reason here.
const BARE: Record<string, string> = {
  "health/route.ts": "uptime checks call it with no session",
  "unsubscribe/route.ts": "one-click unsubscribe; the signed token is the authorization",
  "inbound/resend/route.ts": "Resend webhook; verifies its own signature",
};
// Sign-in has to work before there is a session.
const PUBLIC = new Set(["auth/request/route.ts", "auth/request-access/route.ts", "auth/verify/route.ts", "auth/confirm-email/route.ts", "auth/logout/route.ts"]);

const api = __dirname;
const METHOD = "GET|POST|PUT|PATCH|DELETE";

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return routes(p);
    return e.name === "route.ts" ? [path.relative(api, p).split(path.sep).join("/")] : [];
  });
}

type Handler = { route: string; method: string; wrapper: string };

function handlers(route: string): Handler[] {
  const code = readFileSync(path.join(api, route), "utf8");
  const wrapped = [...code.matchAll(new RegExp(`^export const (${METHOD})\\s*=\\s*(\\w+)\\s*[<(]`, "gm"))];
  const bare = [...code.matchAll(new RegExp(`^export (?:async )?function (${METHOD})\\b`, "gm"))];
  // Re-exports and other shapes would slip past both patterns; fail on them instead.
  const other = [...code.matchAll(new RegExp(`^export (?!const (?:${METHOD})\\s*=|(?:async )?function (?:${METHOD})\\b).*\\b(${METHOD})\\b`, "gm"))];
  return [
    ...wrapped.map((m) => ({ route, method: m[1], wrapper: m[2] })),
    ...bare.map((m) => ({ route, method: m[1], wrapper: "bare" })),
    ...other.map((m) => ({ route, method: m[1], wrapper: "unknown" })),
  ];
}

const all = routes(api).flatMap(handlers);
const where = (h: Handler) => `${h.method} ${h.route} (${h.wrapper})`;

describe("API route auth (#409)", () => {
  it("finds the handlers", () => {
    expect(all.length).toBeGreaterThan(80);
  });

  it("wraps every handler, apart from the listed bare ones", () => {
    const allowed = new Set(["authed", "adminRoute", "publicRoute", "agentRoute", "extensionRoute"]);
    const bad = all.filter((h) => (h.wrapper === "bare" ? !BARE[h.route] : !allowed.has(h.wrapper)));
    expect(bad.map(where)).toEqual([]);
  });

  it("uses adminRoute for everything under /api/admin", () => {
    expect(all.filter((h) => h.route.startsWith("admin/") && h.wrapper !== "adminRoute").map(where)).toEqual([]);
  });

  it("keeps publicRoute to sign-in, and agent and extension wrappers to their own paths", () => {
    const bad = all.filter(
      (h) =>
        (h.wrapper === "publicRoute" && !PUBLIC.has(h.route)) ||
        (h.wrapper === "agentRoute" && !h.route.startsWith("agent/")) ||
        (h.wrapper === "extensionRoute" && !h.route.startsWith("ext/")),
    );
    expect(bad.map(where)).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const bare = new Set(all.filter((h) => h.wrapper === "bare").map((h) => h.route));
    const pub = new Set(all.filter((h) => h.wrapper === "publicRoute").map((h) => h.route));
    expect(Object.keys(BARE).filter((r) => !bare.has(r))).toEqual([]);
    expect([...PUBLIC].filter((r) => !pub.has(r))).toEqual([]);
  });
});
