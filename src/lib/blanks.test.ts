import { describe, expect, it } from "vitest";
import { blankCount, fillTemplate, parseTemplate } from "./blanks";
import { job } from "./kinds";

const team = parseTemplate("Built and led a team of {n:8}[ that {t:shipped the design system}]");

describe("sentence starters with blanks (#254)", () => {
  it("numbers blanks in order and keeps their kind and placeholder", () => {
    expect(blankCount(team)).toBe(2);
    expect(team[0].parts[1]).toEqual({ blank: 0, kind: "n", placeholder: "8" });
    expect(team[1]).toMatchObject({ optional: true });
  });

  it("writes the finished sentence", () => {
    expect(fillTemplate(team, ["8", "shipped the design system"])).toBe("Built and led a team of 8 that shipped the design system.");
  });

  it("drops an optional chunk whose blank is empty", () => {
    expect(fillTemplate(team, ["8", "  "])).toBe("Built and led a team of 8.");
  });

  it("writes nothing while a required blank is empty", () => {
    expect(fillTemplate(team, [])).toBe("");
    expect(fillTemplate(team, ["", "shipped it"])).toBe("");
  });

  it("does not leave a dangling comma when the last chunk drops", () => {
    const won = parseTemplate("Won {s:a hotel group}[, a ${s:2M} account,][ by {t:pitching}]");
    expect(fillTemplate(won, ["Marriott", "2M"])).toBe("Won Marriott, a $2M account.");
    expect(fillTemplate(won, ["Marriott", "2M", "pitching a custom package"])).toBe("Won Marriott, a $2M account, by pitching a custom package.");
  });

  it("no lead-with starter uses __ anymore, and each has a blank", () => {
    const q4 = job.questions.find((q) => q.key === "q4");
    if (q4?.kind !== "text" || !q4.starters) throw new Error("q4 starters missing");
    for (const o of q4.starters.options) {
      expect(o.text).not.toContain("__");
      expect(blankCount(parseTemplate(o.text))).toBeGreaterThan(0);
    }
  });
});
