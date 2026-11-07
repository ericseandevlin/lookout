import { describe, expect, it } from "vitest";
import { LINK_KINDS, LINK_TILE, linkKind } from "./links";

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
