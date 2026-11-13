import { describe, expect, it } from "vitest";
import { parseEmails } from "./emailList";

describe("parseEmails (#993)", () => {
  it("splits on commas, semicolons and new lines", () =>
    expect(parseEmails("a@x.co, b@x.co;c@x.co\nd@x.co").ok).toEqual(["a@x.co", "b@x.co", "c@x.co", "d@x.co"]));
  it("reads a mail client's Name <address> form", () =>
    expect(parseEmails('Ana Diaz <ana@x.co>, "Bo Li" <bo@x.co>')).toEqual({ ok: ["ana@x.co", "bo@x.co"], bad: [] }));
  it("lowercases and drops repeats", () => expect(parseEmails("A@X.co a@x.co").ok).toEqual(["a@x.co"]));
  it("drops a trailing period from a sentence", () => expect(parseEmails("ask ana@x.co.").ok).toEqual(["ana@x.co"]));
  it("reports pieces with an @ that aren't addresses", () => expect(parseEmails("ana@x, bo@x.co, @cy").bad).toEqual(["ana@x", "@cy"]));
  it("returns nothing for an empty paste", () => expect(parseEmails("  \n ")).toEqual({ ok: [], bad: [] }));
});
