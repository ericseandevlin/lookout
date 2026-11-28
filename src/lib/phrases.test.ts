import { describe, expect, it } from "vitest";
import { toggleItem, togglePhrase } from "./phrases";

describe("togglePhrase", () => {
  it("starts a step-up note on an empty answer", () => {
    expect(togglePhrase("", "a bigger title")).toBe("Step up: a bigger title");
  });
  it("adds after existing text, then chains with semicolons", () => {
    const one = togglePhrase("Director of Events at a flagship venue.", "a bigger title");
    expect(one).toBe("Director of Events at a flagship venue. Step up: a bigger title");
    expect(togglePhrase(one, "a real jump in pay")).toBe("Director of Events at a flagship venue. Step up: a bigger title; a real jump in pay");
  });
  it("removes a phrase without touching the rest", () => {
    const v = "Head of Design. Step up: a bigger title; a real jump in pay; leading a larger team";
    expect(togglePhrase(v, "a real jump in pay")).toBe("Head of Design. Step up: a bigger title; leading a larger team");
    expect(togglePhrase(v, "a bigger title")).toBe("Head of Design. Step up: a real jump in pay; leading a larger team");
  });
  it("drops the label when the last phrase goes", () => {
    expect(togglePhrase("Head of Design. Step up: a bigger title", "a bigger title")).toBe("Head of Design.");
    expect(togglePhrase("Step up: a bigger title", "a bigger title")).toBe("");
  });
});

describe("toggleItem (2026-11-27 walkthrough)", () => {
  const common = ["No agencies", "No contract roles", "No early-stage startups"];
  it("lowercases a common answer after the first", () => {
    expect(toggleItem(["No agencies"], "No contract roles", common)).toBe("No agencies, no contract roles");
  });
  it("capitalizes the new first item when the first is taken out", () => {
    expect(toggleItem(["No agencies", "no contract roles"], "No agencies", common)).toBe("No contract roles");
  });
  it("matches any case and keeps typed items as written", () => {
    expect(toggleItem(["Amazon", "no contract roles"], "No contract roles", common)).toBe("Amazon");
    expect(toggleItem(["Amazon"], "No agencies", common)).toBe("Amazon, no agencies");
  });
});
