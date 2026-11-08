import { describe, expect, it } from "vitest";
import type { PersonalStory } from "@/lib/db/schema";
import type { Drafted } from "./draft";
import { checkStory, removeStory, storiesBlock, upsertStory } from "./stories";

const letter: Drafted = { content: "My mom's insulin pump ran on your software. I'm applying for Senior UX Engineer...", note: "Led with the design system work.", sources: ["resume"], question: null };

describe("personal stories", () => {
  it("adds, edits by id and forgets", () => {
    let l = upsertStory([], { theme: "health", story: "  My mom's insulin pump ran on Medtronic software.  " });
    expect(l[0].story).toBe("My mom's insulin pump ran on Medtronic software.");
    const id = l[0].id;
    l = upsertStory(l, { id, theme: "family", story: "Changed" });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ id, theme: "family", story: "Changed" });
    l = upsertStory(l, { theme: "education", story: "Second" });
    expect(l).toHaveLength(2);
    expect(removeStory(l, id).map((s) => s.story)).toEqual(["Second"]);
  });

  it("renders stories with ids for the model, nothing when empty", () => {
    expect(storiesBlock([])).toBe("");
    const l = upsertStory([], { theme: "health", story: "Pump story" });
    expect(storiesBlock(l)).toContain(`[${l[0].id}] (health) Pump story`);
  });
});

describe("the cover letter's personal line", () => {
  const stories: PersonalStory[] = [{ id: "s1", theme: "health", story: "My mom's insulin pump ran on Medtronic software.", updatedAt: "" }];

  it("credits the story it came from", () => {
    const d = checkStory(letter, { storyId: "s1" }, stories, "Medtronic");
    expect(d.question).toBeNull();
    expect(d.note).toContain("Opens with your story");
    expect(d.sources).toContain("your story (health)");
  });

  it("sends the letter back when the line points to a story that doesn't exist", () => {
    const d = checkStory(letter, { storyId: "made-up" }, stories, "Medtronic");
    expect(d.question).toMatch(/never gave Lookout/);
  });

  it("asks one targeted question when no story fits, without replacing the letter", () => {
    const d = checkStory(letter, { storyAsk: "Have you used Duolingo to learn a language?" }, stories, "Duolingo");
    expect(d.question).toBeNull();
    expect(d.content).toBe(letter.content);
    expect(d.note).toContain("Have you used Duolingo to learn a language?");
    expect(checkStory(letter, undefined, [], "Duolingo").note).toContain("Has Duolingo's work");
  });

  it("leaves an empty draft alone", () => {
    const empty = { ...letter, content: "", question: "What should go here?" };
    expect(checkStory(empty, { storyId: "s1" }, stories, "X")).toBe(empty);
  });
});
