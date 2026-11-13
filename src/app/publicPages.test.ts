import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Signed-in people and the public pages (#999).
const redirect = vi.fn((to: string) => {
  throw new Error(`redirect:${to}`);
});
const getSessionUser = vi.fn();
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("@/lib/config", () => ({ getAccessConfig: async () => ({ signupMode: "invite" }) }));
vi.mock("@/lib/groupInvite", () => ({ getGroupInvite: async () => null, blocked: () => "closed" }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));
vi.mock("@/components/Landing", () => ({ Landing: () => null }));
vi.mock("@/components/Login", () => ({ Login: () => null }));
vi.mock("./join/[code]/JoinForm", () => ({ JoinForm: () => null }));

const params = (o: Record<string, string>) => Promise.resolve(o);

describe("public pages for a signed-in person", () => {
  beforeEach(() => {
    redirect.mockClear();
    getSessionUser.mockResolvedValue({ id: "u1" });
  });

  it("the site and the sign-in page go to the board by default", async () => {
    const Home = (await import("./page")).default;
    const SignIn = (await import("./signin/page")).default;
    await expect(Home({ searchParams: params({}) })).rejects.toThrow("redirect:/finds");
    await expect(SignIn({ searchParams: params({}) })).rejects.toThrow("redirect:/finds");
  });

  it("?view=1 shows them instead", async () => {
    const Home = (await import("./page")).default;
    const SignIn = (await import("./signin/page")).default;
    await Home({ searchParams: params({ view: "1" }) });
    await SignIn({ searchParams: params({ view: "1" }) });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("a group link page shows, with a note, and never redirects", async () => {
    const Join = (await import("./join/[code]/page")).default;
    const html = renderToStaticMarkup(await Join({ params: Promise.resolve({ code: "JamLab" }) }));
    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain("You are signed in");
    expect(html).toContain('href="/finds"');
  });

  it("a signed-out visitor sees no note", async () => {
    getSessionUser.mockResolvedValue(null);
    const Join = (await import("./join/[code]/page")).default;
    expect(renderToStaticMarkup(await Join({ params: Promise.resolve({ code: "jamlab" }) }))).not.toContain("You are signed in");
  });
});
