import { describe, expect, it } from "vitest";
import { checkLinks, checkPage, formatReport, groupFindings } from "./flow-check-rules.mjs";

type Finding = { kind: string; step: string; url: string; detail: string };

const ok = {
  step: "Sign in",
  url: "http://x/signin",
  status: 200,
  headings: ["Sign in to Lookout"],
  actions: [{ role: "button", name: "Email me a sign-in link" }],
  consoleErrors: [],
  failedRequests: [],
  text: "We'll send you a one-time sign-in link.",
};
const kinds = (snap: object) => (checkPage({ ...ok, ...snap }) as Finding[]).map((f) => f.kind);

describe("flow check rules (#996)", () => {
  it("a page that loads, names itself and offers a clear next step has no findings", () => {
    expect(checkPage(ok)).toEqual([]);
  });

  it("an error status is a finding unless the step expects it", () => {
    expect(kinds({ status: 500 })).toEqual(["page-error"]);
    expect(kinds({ status: 404, expectStatus: 404 })).toEqual([]);
  });

  it("script errors and failed requests are findings", () => {
    expect(kinds({ consoleErrors: ["TypeError: x is undefined"], failedRequests: [{ url: "/api/finds", status: 500 }] })).toEqual(["script-error", "failed-request"]);
  });

  it("no enabled action is a dead end; no heading is flagged", () => {
    expect(kinds({ actions: [{ role: "button", name: "Save", disabled: true }] })).toEqual(["dead-end"]);
    expect(kinds({ headings: [] })).toEqual(["no-heading"]);
  });

  it("flags unnamed and vague controls, not clear ones", () => {
    expect(kinds({ actions: [{ role: "button", name: "" }, { role: "link", name: "Click here.", href: "/x" }, { role: "button", name: "Save notes" }] })).toEqual(["unnamed-control", "vague-label"]);
  });

  it("a step missing the words that say what happens next is a finding", () => {
    expect(kinds({ expectText: "inbox" })).toEqual(["expect-missing"]);
    expect(kinds({ expectText: ["sign-in LINK"] })).toEqual([]);
  });

  it("links: errors and 4xx/5xx are broken, redirects and 200 are not", () => {
    const found = checkLinks([
      { url: "/terms", status: 200, from: ["Sign in"] },
      { url: "/gone", status: 404, from: ["Landing page", "Sign in"] },
      { url: "https://example.com/x", error: "timeout", from: ["Privacy"] },
    ]) as Finding[];
    expect(found.map((f) => [f.url, f.detail, f.step])).toEqual([
      ["/gone", "HTTP 404", "Landing page, Sign in"],
      ["https://example.com/x", "timeout", "Privacy"],
    ]);
  });

  it("groups the same problem across pages into one issue, highest severity first", () => {
    const groups = groupFindings([
      { kind: "no-heading", step: "A", url: "", detail: "d" },
      { kind: "no-heading", step: "B", url: "", detail: "d" },
      { kind: "page-error", step: "C", url: "", detail: "HTTP 500" },
    ]);
    expect(groups.map((g: { kind: string; steps: string[] }) => [g.kind, g.steps])).toEqual([
      ["page-error", ["C"]],
      ["no-heading", ["A", "B"]],
    ]);
  });

  it("the report lists issues to open, or says there are none", () => {
    const pages = [{ step: "Sign in", path: "/signin", status: 200 }];
    const clean = formatReport({ base: "http://x", startedAt: "t", pages, findings: [], signedIn: false });
    expect(clean).toContain("Found 0 issues");
    expect(clean).toContain("signed out only");
    const bad = formatReport({ base: "http://x", startedAt: "t", pages, findings: [{ kind: "broken-link", step: "Sign in", url: "/gone", detail: "HTTP 404" }], signedIn: true });
    expect(bad).toContain("## Issues to open");
    expect(bad).toContain("[high] Link goes nowhere.");
  });
});
