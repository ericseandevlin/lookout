import { describe, expect, it } from "vitest";
import { mailFooter, readUnsubscribeToken, unsubscribeHeaders, unsubscribeToken } from "./emailRules";

const S = "s".repeat(32);
const OLD = "o".repeat(32);

describe("unsubscribe tokens (#28)", () => {
  it("round-trips the address and list", () => {
    expect(readUnsubscribeToken(unsubscribeToken(S, "news", "a@example.com"), [S])).toEqual({ list: "news", email: "a@example.com" });
    expect(readUnsubscribeToken(unsubscribeToken(S, "digest", "a@example.com"), [S])).toEqual({ list: "digest", email: "a@example.com" });
  });

  it("rejects a token with a swapped address or list", () => {
    const [, , sig] = unsubscribeToken(S, "digest", "a@example.com").split(".");
    expect(readUnsubscribeToken(`news.${Buffer.from("a@example.com").toString("base64url")}.${sig}`, [S])).toBeNull();
    expect(readUnsubscribeToken(`digest.${Buffer.from("b@example.com").toString("base64url")}.${sig}`, [S])).toBeNull();
  });

  it("rejects junk and another secret's tokens", () => {
    for (const t of ["", "news", "news..", "other.YQ.x", "news.bm8tYXQ.x"]) expect(readUnsubscribeToken(t, [S])).toBeNull();
    expect(readUnsubscribeToken(unsubscribeToken("x".repeat(32), "news", "a@example.com"), [S])).toBeNull();
  });

  it("still reads links signed with the previous secret during a rotation", () => {
    expect(readUnsubscribeToken(unsubscribeToken(OLD, "news", "a@example.com"), [S, OLD])?.email).toBe("a@example.com");
  });
});

describe("mail footer and headers", () => {
  it("has the link and address, escaped in HTML", () => {
    const f = mailFooter({ why: "Because <you> asked.", link: "https://l.test/unsubscribe?t=a&b", address: "PO Box 1, New York, NY" });
    expect(f.html).toContain("Because &lt;you&gt; asked.");
    expect(f.html).toContain('href="https://l.test/unsubscribe?t=a&amp;b"');
    expect(f.html).toContain("PO Box 1, New York, NY");
    expect(f.text).toBe("Because <you> asked. Unsubscribe: https://l.test/unsubscribe?t=a&b\nLookout · PO Box 1, New York, NY");
  });

  it("leaves the address line out when none is set", () => {
    expect(mailFooter({ why: "W.", link: "L", address: "" }).text).toBe("W. Unsubscribe: L");
  });

  it("asks for one-click unsubscribe", () => {
    expect(unsubscribeHeaders("https://l.test/api/unsubscribe?t=x")).toEqual({
      "List-Unsubscribe": "<https://l.test/api/unsubscribe?t=x>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});
