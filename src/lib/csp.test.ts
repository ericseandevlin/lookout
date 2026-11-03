import { describe, expect, it } from "vitest";
import { API_CSP, newNonce, pageCsp } from "./csp";

describe("pageCsp", () => {
  const csp = pageCsp("abc123");
  const dir = (name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

  it("scripts need the nonce; no unsafe-inline or unsafe-eval", () => {
    expect(dir("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(dir("script-src")).not.toMatch(/unsafe/);
  });

  it("keeps the other locks", () => {
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"]) expect(csp).toContain(d);
  });
});

describe("newNonce", () => {
  it("is 128 bits of base64 and differs each time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});

it("API responses allow nothing", () => expect(API_CSP).toBe("default-src 'none'; frame-ancestors 'none'"));
