import { describe, expect, it } from "vitest";
import { bullets, parseNote } from "./notes";

describe("notes as lists", () => {
  it("round-trips bullet notes with sub-points", () => {
    const n = bullets(["Keyword match 3/25 → 11/25", { text: "Added:", sub: ["KPIs (Experience: RPM, Skills)", "AI fluency (Summary)"] }, false, "Left out product strategy as you asked"]);
    expect(n).toBe("- Keyword match 3/25 → 11/25\n- Added:\n  - KPIs (Experience: RPM, Skills)\n  - AI fluency (Summary)\n- Left out product strategy as you asked");
    expect(parseNote(n)).toEqual([
      { text: "Keyword match 3/25 → 11/25", sub: [] },
      { text: "Added:", sub: ["KPIs (Experience: RPM, Skills)", "AI fluency (Summary)"] },
      { text: "Left out product strategy as you asked", sub: [] },
    ]);
  });

  it("splits an older paragraph note into points, with Added as a sub-list", () => {
    const old =
      "Redrafted from the posting. Keyword match 3/25 → 11/25. Added: consumer-facing (Summary, Experience: Citi), KPIs (Experience: RPM, Skills). Left out product strategy as you asked. Check these numbers, they aren't in your master resume: 17+.";
    expect(parseNote(old)).toEqual([
      { text: "Redrafted from the posting.", sub: [] },
      { text: "Keyword match 3/25 → 11/25.", sub: [] },
      { text: "Added:", sub: ["consumer-facing (Summary, Experience: Citi)", "KPIs (Experience: RPM, Skills)"] },
      { text: "Left out product strategy as you asked.", sub: [] },
      { text: "Check these numbers, they aren't in your master resume: 17+.", sub: [] },
    ]);
  });

  it("keeps a one-sentence note as one point", () => {
    expect(parseNote("From your account name.")).toEqual([{ text: "From your account name.", sub: [] }]);
  });
});
