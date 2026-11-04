import { describe, expect, it } from "vitest";
import { forwardTo, goLink } from "./digestLinks";

const app = "https://lookout.example";

describe("digest links", () => {
  it("builds the /go link", () => expect(goLink(app, "d1", "board")).toBe("https://lookout.example/go/d1/board"));
  it("forwards to the posting when it's a web address", () => expect(forwardTo("https://jobs.lever.co/acme/1", app)).toBe("https://jobs.lever.co/acme/1"));
  it("falls back to the board for anything else", () => {
    for (const bad of [null, "", "javascript:alert(1)", "data:text/html,x", "not a url"]) expect(forwardTo(bad, app)).toBe("https://lookout.example/finds");
  });
});
