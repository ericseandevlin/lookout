import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { classify, DECLINE, eeoPicks, eeoRunOf, emptyEeo, matchOption, resolve, sourceLabel } from "./eeo";
import { planFill } from "./fillPlan";
import { answerKey } from "./saved";

// Real option lists from Greenhouse boards (Attentive, CLEAR, Understood), 2026-10-17.
const attentiveGender = ["Female", "Male", "Nonbinary", "Decline to self-identify"];
const clearGender = ["Man", "Non-binary", "Woman", "I prefer to self-describe", "I don't wish to answer"];
const eeocGender = ["Decline To Self Identify", "Female", "Male"];
const clearVeteran = ["Yes, I am a veteran or active member", "No, I am not a veteran or active member", "I prefer to self-describe", "I don't wish to answer"];
const eeocVeteran = ["I don't wish to answer", "I identify as one or more of the classifications of protected veteran", "I am not a protected veteran"];
const clearRace = ["Black or of African descent", "East Asian", "Hispanic, Latinx or of Spanish Origin", "White", "I don't wish to answer"];

describe("classify", () => {
  it("reads the category from the form's wording", () => {
    expect(classify("How would you describe your gender identity? (mark all that apply)")).toBe("gender");
    expect(classify("Do you identify as transgender?")).toBe("transgender");
    expect(classify("VeteranStatus")).toBe("veteran");
    expect(classify("Are you a veteran or active member of the United States Armed Forces?")).toBe("veteran");
    expect(classify("How would you describe your racial/ethnic background?")).toBe("race");
    expect(classify("Do you have a disability or chronic condition?")).toBe("disability");
    expect(classify("Why do you want this job?")).toBeNull();
  });
});

describe("matchOption", () => {
  it("matches the same answer across different wordings", () => {
    expect(matchOption("Man", attentiveGender)).toBe("Male");
    expect(matchOption("Man", clearGender)).toBe("Man");
    expect(matchOption("Woman", eeocGender)).toBe("Female");
    expect(matchOption("Non-binary", attentiveGender)).toBe("Nonbinary");
  });

  it("finds the decline option however it's worded", () => {
    expect(matchOption(DECLINE, attentiveGender)).toBe("Decline to self-identify");
    expect(matchOption(DECLINE, clearGender)).toBe("I don't wish to answer");
    expect(matchOption(DECLINE, eeocGender)).toBe("Decline To Self Identify");
  });

  it("never mixes up veteran and not a veteran", () => {
    expect(matchOption("Not a veteran", clearVeteran)).toBe("No, I am not a veteran or active member");
    expect(matchOption("Veteran", clearVeteran)).toBe("Yes, I am a veteran or active member");
    expect(matchOption("Not a veteran", eeocVeteran)).toBe("I am not a protected veteran");
    expect(matchOption("Veteran", eeocVeteran)).toBe("I identify as one or more of the classifications of protected veteran");
  });

  it("returns nothing rather than guess", () => {
    expect(matchOption("Asian", clearRace)).toBe("East Asian");
    expect(matchOption("Middle Eastern or North African", clearRace)).toBeNull();
  });
});

describe("resolve", () => {
  const q = "How would you describe your racial/ethnic background?";
  it("prefers the answer the person picked for this exact wording", () => {
    const p = { answers: { race: "Asian" }, exact: { [answerKey(q)]: "White" } };
    expect(resolve(p, q, clearRace)).toBe("White");
  });

  it("falls back to the category answer, and to nothing", () => {
    expect(resolve({ answers: { gender: "Woman" }, exact: {} }, "Gender", eeocGender)).toBe("Female");
    expect(resolve({ answers: {}, exact: {} }, "Gender", eeocGender)).toBeNull();
  });
});

describe("eeoPicks (per application)", () => {
  const items = [
    { id: "g", kind: "eeo", prompt: "Gender", options: eeocGender },
    { id: "v", kind: "eeo", prompt: "VeteranStatus", options: eeocVeteran },
    { id: "w", kind: "answer", prompt: "Why do you want this job?", options: null },
  ];
  const profile = { answers: { gender: "Woman", veteran: "Not a veteran" }, exact: {} };

  it("fills nothing until this application's switch is on, and never without the profile permission", () => {
    expect(eeoPicks(items, profile, true, { on: false, skip: [] })).toEqual([]);
    expect(eeoPicks(items, profile, false, { on: true, skip: [] })).toEqual([]);
    expect(eeoRunOf({})).toEqual({ on: false, skip: [] });
  });

  it("fills only saved answers, says where each came from, and leaves skipped ones blank", () => {
    const picks = eeoPicks(items, profile, true, { on: true, skip: ["v"] });
    expect(picks).toEqual([{ itemId: "g", prompt: "Gender", category: "gender", source: "category", answer: "Female" }]);
    expect(sourceLabel(picks[0])).toBe("your Gender answer");
    const exact = eeoPicks(items, { answers: {}, exact: { [answerKey("Gender")]: "Male" } }, true, { on: true, skip: [] });
    expect(exact.map((p) => [p.answer, sourceLabel(p)])).toEqual([["Male", "your pick for this wording"]]);
  });

  it("has nothing to fill with no saved answers, whatever else the profile holds", () => {
    expect(eeoPicks(items, emptyEeo(), true, { on: true, skip: [] })).toEqual([]);
  });
});

describe("EEO answers never reach outbound documents", () => {
  // Distinctive answers, so any leak into a document is easy to see.
  const profile = { answers: { race: "Native Hawaiian or Pacific Islander", veteran: "Veteran" }, exact: {} };
  const race = ["Native Hawaiian or Pacific Islander", "White", "Decline to self-identify"];
  const items = [
    { id: "r", kind: "resume" as const, prompt: "Resume", required: true, fieldType: "file", options: null, approvedVersionId: "v1" },
    { id: "c", kind: "cover_letter" as const, prompt: "Cover letter", required: false, fieldType: "file", options: null, approvedVersionId: "v2" },
    { id: "o", kind: "outreach" as const, prompt: "Note to the hiring manager", required: false, fieldType: null, options: null, approvedVersionId: "v3" },
    { id: "a", kind: "answer" as const, prompt: "Why us?", required: false, fieldType: "textarea", options: null, approvedVersionId: "v4" },
    // A stray version on an EEO item must still never be filled or sent as text.
    { id: "e", kind: "eeo" as const, prompt: "Race", required: false, fieldType: "select", options: race, approvedVersionId: "v5" },
    { id: "e2", kind: "eeo" as const, prompt: "VeteranStatus", required: false, fieldType: "select", options: eeocVeteran, approvedVersionId: null },
  ];
  const versions = [
    { id: "v1", content: "# Pat Lee\nDesigner" },
    { id: "v2", content: "Dear team," },
    { id: "v3", content: "Hi there" },
    { id: "v4", content: "Because." },
    { id: "v5", content: "Native Hawaiian or Pacific Islander" },
  ];
  const leaks = (t: string) => /hawaiian|pacific islander|protected veteran/i.test(t);

  for (const consent of [false, true])
    for (const on of [false, true])
      for (const skip of [[], ["e"], ["e", "e2"]])
        it(`profile ${consent ? "on" : "off"}, application ${on ? "on" : "off"}, ${skip.length} skipped`, () => {
          const docs = planFill(items, versions);
          expect(docs.some((s) => s.itemKind === "eeo")).toBe(false);
          expect(docs.some((s) => leaks(s.content))).toBe(false);
          const picks = eeoPicks(items, profile, consent, { on, skip });
          if (!consent || !on) expect(picks).toEqual([]);
          expect(picks.map((p) => p.itemId).filter((id) => skip.includes(id))).toEqual([]);
          // Each pick is only a choice on its own EEO field, never part of another item.
          for (const p of picks) expect(items.find((i) => i.id === p.itemId)?.kind).toBe("eeo");
        });

  it("only the profile route, the review screen and the form filler can read saved EEO answers", () => {
    const root = path.resolve(__dirname, "../..");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"));
    const readers = files.filter((f) => /from "[^"]*eeoStore"/.test(readFileSync(path.join(root, f), "utf8"))).sort();
    expect(readers).toEqual(["app/api/profile/eeo/route.ts", "lib/application/review.ts", "lib/application/submit.ts"].map((f) => f.split("/").join(path.sep)));
  });
});
