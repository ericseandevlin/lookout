import { describe, expect, it } from "vitest";
import { BONUS_KEY, answeredCount, job } from ".";

describe("job brief", () => {
  it("adds bonus context when given", () => {
    expect(job.brief({ q1: "Director", [BONUS_KEY]: " Open to Chicago later " })).toContain("Other context from them: Open to Chicago later");
  });

  it("leaves the brief unchanged without bonus context", () => {
    expect(job.brief({ q1: "Director", [BONUS_KEY]: "  " })).toBe(job.brief({ q1: "Director" }));
  });

  it("doesn't count bonus context as an answer", () => {
    expect(answeredCount(job, { [BONUS_KEY]: "x" })).toBe(0);
  });
});
