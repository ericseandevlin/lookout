import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

const req = (path: string, signedIn = false) => new NextRequest(`https://lookout.test${path}`, { headers: signedIn ? { cookie: "lookout_session=abc" } : {} });
// NextResponse.next({ request: { headers } }) hands the new request headers to Next as x-middleware-request-*.
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy: sign-in gate", () => {
  it.each(["/finds", "/finds/abc", "/events", "/profile/materials", "/settings", "/admin/errors"])("sends a signed-out visitor from %s to the home page", (path) => {
    const res = proxy(req(path));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://lookout.test/");
  });

  it.each(["/", "/privacy", "/terms", "/findsx", "/profiles", "/auth/verify", "/welcome"])("lets %s through without a session", (path) => {
    expect(proxy(req(path)).headers.get("location")).toBeNull();
  });

  it("lets a visitor with a session cookie through; the page checks the session itself", () => {
    expect(proxy(req("/finds", true)).headers.get("location")).toBeNull();
  });
});

describe("proxy: CSP", () => {
  it("sets the same nonce CSP on the page response and the request Next renders with", () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = proxy(req("/finds", true));
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(forwarded(res, "content-security-policy")).toBe(csp);
    expect(forwarded(res, "x-nonce")).toBe(nonceOf(csp));
  });

  it("uses a new nonce for every request", () => {
    vi.stubEnv("NODE_ENV", "production");
    const a = nonceOf(proxy(req("/")).headers.get("content-security-policy"));
    const b = nonceOf(proxy(req("/")).headers.get("content-security-policy"));
    expect(a).toMatch(/^[\w+/=-]{16,}$/);
    expect(a).not.toBe(b);
  });

  it("sets no CSP outside production, where React's dev build needs eval", () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = proxy(req("/finds", true));
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(forwarded(res, "x-nonce")).toBeNull();
  });

  it("still gates pages in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(proxy(req("/admin")).status).toBe(307);
  });
});

describe("proxy: matcher", () => {
  const runs = (path: string, headers: Record<string, string> = {}) => unstable_doesMiddlewareMatch({ config, url: path, headers });

  it("runs on pages", () => {
    for (const p of ["/", "/finds", "/profile/sees", "/privacy"]) expect(runs(p), p).toBe(true);
  });

  it("skips API routes, static files and the extension's files", () => {
    for (const p of ["/api/finds", "/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/ext/popup.html"]) expect(runs(p), p).toBe(false);
  });

  it("skips prefetches, which don't render a page", () => {
    expect(runs("/finds", { "next-router-prefetch": "1" })).toBe(false);
    expect(runs("/finds", { purpose: "prefetch" })).toBe(false);
  });
});
