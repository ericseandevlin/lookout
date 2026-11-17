import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The marketing pages behind FEATURE_WAITLIST (#9).
const notFound = vi.fn(() => {
  throw new Error("notFound");
});
vi.mock("next/navigation", () => ({ notFound, redirect: vi.fn() }));
vi.mock("@/lib/config", () => ({ getAccessConfig: async () => ({ signupMode: "invite" }) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => null }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));
vi.mock("next/image", () => ({ default: () => createElement("img") }));

const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const pages = { jobs: () => import("./jobs/page"), kinds: () => import("./what-it-finds/page") };

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
});

describe("marketing pages", () => {
  it("are 404 while the switch is off", async () => {
    for (const load of Object.values(pages)) await expect((await load()).default({ searchParams: sp() })).rejects.toThrow("notFound");
  });

  it("render with the switch on, and the call to action keeps a channel test's ref", async () => {
    vi.stubEnv("FEATURE_WAITLIST", "on");
    for (const load of Object.values(pages)) {
      const html = renderToStaticMarkup(await (await load()).default({ searchParams: sp({ ref: "hn" }) }));
      expect(html).toContain('href="/request-access?ref=hn"');
      expect(html).toContain("Join the waitlist");
      expect(html).toContain('href="/what-it-finds"');
      expect(html).not.toContain("—");
    }
  });

  it("the home page links them only when the switch is on", async () => {
    const { Landing } = await import("@/components/landing/Landing");
    expect(renderToStaticMarkup(createElement(Landing, { inviteOnly: true, channel: null }))).not.toContain('href="/jobs"');
    const on = renderToStaticMarkup(createElement(Landing, { inviteOnly: true, channel: null, pages: true }));
    expect(on).toContain('href="/jobs"');
    expect(on).toContain("Join the waitlist");
  });
});
