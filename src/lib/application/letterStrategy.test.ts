import { describe, expect, it } from "vitest";
import type { PersonalStory } from "@/lib/db/schema";
import { fittingStory, isStrategy, suggestStrategy } from "./letterStrategy";
import { answersPrompt, type DraftInputs } from "./draft";

const story = (theme: PersonalStory["theme"], text = "My mother's care team changed how I think about software."): PersonalStory => ({ id: "s1", theme, story: text, updatedAt: "2026-11-01" });

describe("cover letter strategies (#738)", () => {
  it("suggests why-this-team when a story's theme runs through the posting", () => {
    const posting = { title: "Product Designer", text: "We build tools for patients and their care teams. Clinical staff rely on us." };
    expect(fittingStory([story("health")], posting.text)?.id).toBe("s1");
    expect(suggestStrategy(posting, [story("health")]).strategy).toBe("why");
  });

  it("needs two theme hits, not one passing mention", () => {
    expect(fittingStory([story("health")], "We offer health insurance.")).toBeNull();
  });

  it("does not count benefits or tech phrases as a theme (#856)", () => {
    const benefits = "Medical, dental and vision insurance. A health savings account and a wellness stipend. Health and wellness perks.";
    expect(fittingStory([story("health")], benefits)).toBeNull();
    expect(suggestStrategy({ title: "Designer", text: benefits }, [story("health")]).strategy).toBe("match");
    expect(fittingStory([story("education")], "Machine learning and deep learning models. A learning and development budget.")).toBeNull();
    expect(fittingStory([story("entertainment")], "Run our social media. Grow social media reach.")).toBeNull();
    expect(fittingStory([story("family")], "Paid family leave and parental leave. A family-friendly culture.")).toBeNull();
    expect(fittingStory([story("finance")], "We invest in our people and invest in your growth.")).toBeNull();
    expect(fittingStory([story("health")], "We care about craft. We truly care about users.")).toBeNull();
  });

  it("still counts the theme when the company works in it, benefits aside (#856)", () => {
    const text = "We build tools for patients and clinical teams. Plus medical and dental insurance.";
    expect(fittingStory([story("health")], text)?.id).toBe("s1");
    expect(fittingStory([story("education")], "We help students and teachers. Machine learning powers it.")?.id).toBe("s1");
  });

  it("counts healthcare and hospitals as health words (#942)", () => {
    expect(fittingStory([story("health")], "We build software for hospitals. Our healthcare platform runs in 40 states.")?.id).toBe("s1");
    expect(fittingStory([story("health")], "Healthcare benefits and healthcare insurance. Healthcare, dental and vision.")).toBeNull();
  });

  it("suggests lead-with-proof for senior roles and match-the-asks otherwise", () => {
    expect(suggestStrategy({ title: "Senior Design Engineer", text: "Build things." }, []).strategy).toBe("proof");
    expect(suggestStrategy({ title: "Director, UX Engineering", text: "Build things." }, []).strategy).toBe("proof");
    expect(suggestStrategy({ title: "Design Engineer", text: "Build things." }, []).strategy).toBe("match");
  });

  it("checks strategy names", () => {
    expect(isStrategy("proof")).toBe(true);
    expect(isStrategy("bold")).toBe(false);
  });

  it("puts the chosen strategy's rule in the prompt only when a cover letter is drafted", () => {
    const inp: DraftInputs = { name: "A", email: "a@x.co", linkedinUrl: null, links: [], brief: "", resume: "", posting: { company: "Co", title: "Designer", text: "" }, letterStrategy: "why" };
    expect(answersPrompt(inp, [{ index: 0, kind: "cover_letter", prompt: "Cover letter", required: false }])).toContain("Cover letter strategy: why this team.");
    expect(answersPrompt(inp, [{ index: 0, kind: "answer", prompt: "Why us?", required: false }])).not.toContain("Cover letter strategy");
  });
});
