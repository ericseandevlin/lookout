import { describe, expect, it } from "vitest";
import { LINK_KINDS, LINK_TILE, cleanUrl, hrefOf, linkKind } from "./links";

describe("linkKind", () => {
  it("knows each platform", () => {
    expect(linkKind("https://www.instagram.com/eric")).toBe("Instagram");
    expect(linkKind("https://www.tiktok.com/@eric")).toBe("TikTok");
    expect(linkKind("https://twitter.com/eric")).toBe("X");
    expect(linkKind("https://github.com/eric")).toBe("GitHub");
    expect(linkKind("https://www.youtube.com/@eric")).toBe("YouTube");
    expect(linkKind("https://www.behance.net/eric")).toBe("Behance");
    expect(linkKind("https://dribbble.com/eric")).toBe("Dribbble");
    expect(linkKind("https://www.linkedin.com/in/eric")).toBe("LinkedIn");
  });
  it("knows youtu.be short links", () => {
    expect(linkKind("https://youtu.be/dQw4w9WgXcQ")).toBe("YouTube");
  });
  it("knows x.com but not domains that only contain it", () => {
    expect(linkKind("https://x.com/eric")).toBe("X");
    expect(linkKind("x.com/eric")).toBe("X");
    expect(linkKind("https://www.box.com/s/abc")).toBe("Website");
    expect(linkKind("https://netflix.com/title/1")).toBe("Website");
  });
  it("reads the host, not a path that names a platform (#496)", () => {
    expect(linkKind("https://janedoe.com/work/instagram-stories")).toBe("Website");
    expect(linkKind("https://janedoe.com/youtube-redesign")).toBe("Website");
    expect(linkKind("janedoe.com/case-studies/linkedin")).toBe("Website");
    expect(linkKind("https://my-x.com")).toBe("Website");
    expect(linkKind("https://notgithub.com/eric")).toBe("Website");
    expect(linkKind("https://example.com/?ref=twitter.com")).toBe("Website");
    expect(linkKind("https://example.com/mastodon.social/@eric")).toBe("Website");
  });
  it("still knows subdomains and short hosts", () => {
    expect(linkKind("https://eric.github.io")).toBe("GitHub");
    expect(linkKind("https://m.youtube.com/watch?v=1")).toBe("YouTube");
    expect(linkKind("HTTPS://WWW.LinkedIn.com/in/eric")).toBe("LinkedIn");
    expect(linkKind("https://lnkd.in/abc")).toBe("LinkedIn");
    expect(linkKind("  instagram.com/eric ")).toBe("Instagram");
  });
  it("labels site builders as Portfolio", () => {
    for (const u of ["https://eric.squarespace.com", "https://eric.wixsite.com/work", "https://eric.format.com", "https://eric.cargo.site"]) expect(linkKind(u)).toBe("Portfolio");
  });
  it("falls back to Website", () => {
    expect(linkKind("https://ericdevlin.co")).toBe("Website");
    expect(linkKind("")).toBe("Website");
  });
});

describe("cleanUrl", () => {
  it("strips the scheme, www. and one trailing slash", () => {
    expect(cleanUrl("https://www.ericdevlin.co/")).toBe("ericdevlin.co");
    expect(cleanUrl("http://ericdevlin.co/work/")).toBe("ericdevlin.co/work");
    expect(cleanUrl("HTTPS://WWW.Example.com")).toBe("Example.com");
  });
  it("only strips one trailing slash", () => {
    expect(cleanUrl("https://example.com//")).toBe("example.com/");
  });
  it("leaves bare hosts and www inside the path alone", () => {
    expect(cleanUrl("ericdevlin.co")).toBe("ericdevlin.co");
    expect(cleanUrl("example.com/www.foo")).toBe("example.com/www.foo");
  });
});

describe("hrefOf", () => {
  it("adds https:// when there is no scheme", () => {
    expect(hrefOf("ericdevlin.co")).toBe("https://ericdevlin.co");
    expect(hrefOf("www.ericdevlin.co/work")).toBe("https://www.ericdevlin.co/work");
  });
  it("keeps an existing http or https scheme", () => {
    expect(hrefOf("https://ericdevlin.co")).toBe("https://ericdevlin.co");
    expect(hrefOf("http://ericdevlin.co")).toBe("http://ericdevlin.co");
    expect(hrefOf("HTTPS://ericdevlin.co")).toBe("HTTPS://ericdevlin.co");
  });
});

describe("linkKind social and newsletter links", () => {
  it("knows Bluesky", () => {
    expect(linkKind("https://bsky.app/profile/eric.bsky.social")).toBe("Bluesky");
    expect(linkKind("bsky.app/profile/eric")).toBe("Bluesky");
  });
  it("knows Threads on both domains", () => {
    expect(linkKind("https://www.threads.net/@eric")).toBe("Threads");
    expect(linkKind("threads.com/@eric")).toBe("Threads");
  });
  it("knows Mastodon profiles on common instances", () => {
    for (const u of ["https://mastodon.social/@eric", "mastodon.online/@eric", "https://hachyderm.io/@eric", "mas.to/@eric", "https://fosstodon.org/@eric", "https://mstdn.social/@eric"]) expect(linkKind(u)).toBe("Mastodon");
  });
  it("leaves other /@ pages and instance home pages alone", () => {
    expect(linkKind("https://medium.com/@eric")).toBe("Website");
    expect(linkKind("https://mastodon.social/about")).toBe("Website");
    expect(linkKind("https://example.com/@eric")).toBe("Website");
  });
  it("knows Substack newsletters and profiles", () => {
    expect(linkKind("https://eric.substack.com/p/first-post")).toBe("Substack");
    expect(linkKind("substack.com/@eric")).toBe("Substack");
  });
  it("does not match lookalike domains", () => {
    expect(linkKind("https://notbsky.app/x")).toBe("Website");
    expect(linkKind("https://mythreads.net/shop")).toBe("Website");
  });
  it("gives every kind a tile", () => {
    for (const k of LINK_KINDS) expect(LINK_TILE[k]).toBeDefined();
  });
});
