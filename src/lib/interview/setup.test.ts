import { describe, expect, it } from "vitest";
import { job, type Question } from "@/lib/kinds";
import { isAnswered, readSetupAnswer, setupFact, setupQuestionText } from "./setup";

const q = (key: string) => job.questions.find((x) => x.key === key)!;
const comp = q("comp");
const where = q("where");

describe("setupQuestionText", () => {
  it("adds a pay example to the comp question", () => {
    expect(setupQuestionText(comp)).toBe(`${comp.prompt} A floor and a number that would make you move, for example "140k floor, 180k to jump".`);
  });

  it("adds the work modes hint to the modes question", () => {
    expect(setupQuestionText(where)).toBe(`${where.prompt} On-site, hybrid or remote, and which areas.`);
  });

  it("adds the helper to a text question", () => {
    const t = q("q1") as Extract<Question, { kind: "text" }>;
    expect(setupQuestionText(t)).toBe(`${t.prompt} ${t.helper}`);
  });
});

describe("readSetupAnswer: pay", () => {
  it("reads a floor and a number to move for", () => {
    expect(readSetupAnswer(comp, "140k floor, 180k to jump")).toEqual({
      answers: { floor: "140000", target: "180000" },
      fact: { text: "Pay floor $140,000; would move for $180,000.", kind: "pay" },
    });
  });

  it("takes the lower number as the floor whatever the order", () => {
    expect(readSetupAnswer(comp, "180k to jump, 140k floor").answers).toEqual({ floor: "140000", target: "180000" });
  });

  it("reads one amount as the floor only", () => {
    expect(readSetupAnswer(comp, "$150,000")).toEqual({ answers: { floor: "150000" }, fact: { text: "Pay floor $150,000.", kind: "pay" } });
  });

  it("reads a bare number under 1000 as thousands, and m as millions", () => {
    expect(readSetupAnswer(comp, "140").answers).toEqual({ floor: "140000" });
    expect(readSetupAnswer(comp, "1.2m").answers).toEqual({ floor: "1200000" });
  });

  it("skips numbers too small to be a salary", () => {
    expect(readSetupAnswer(comp, "5 years in, 140k").answers).toEqual({ floor: "140000" });
  });

  it("keeps the words as a private pay fact when there is no amount", () => {
    expect(readSetupAnswer(comp, "  whatever is fair ")).toEqual({ answers: {}, fact: { text: "whatever is fair", kind: "pay" } });
  });
});

describe("readSetupAnswer: work modes", () => {
  it("reads the modes and the area", () => {
    expect(readSetupAnswer(where, "Remote, NYC")).toEqual({
      answers: { modes: ["Remote"], area: "NYC" },
      fact: { text: "Remote, NYC", kind: "next_role" },
    });
  });

  it("drops a leading 'in' from the area", () => {
    expect(readSetupAnswer(where, "On-site in Austin").answers).toEqual({ modes: ["On-site"], area: "Austin" });
  });

  it("drops every joining word left between the modes and the area", () => {
    expect(readSetupAnswer(where, "Hybrid or remote in Brooklyn").answers.area).toBe("Brooklyn");
    expect(readSetupAnswer(where, "Remote, or in or around Boston").answers.area).toBe("Boston");
  });

  it("keeps an area whose name starts like a joining word", () => {
    expect(readSetupAnswer(where, "Hybrid in Orlando").answers.area).toBe("Orlando");
    expect(readSetupAnswer(where, "Remote, Indianapolis").answers.area).toBe("Indianapolis");
  });

  it("reads several modes in the config's order", () => {
    expect(readSetupAnswer(where, "remote or hybrid").answers.modes).toEqual(["Hybrid", "Remote"]);
  });

  it("keeps only the modes the question offers", () => {
    const remoteOnly = { ...where, options: ["Remote"] } as Question;
    expect(readSetupAnswer(remoteOnly, "hybrid").answers).toEqual({ modes: [], area: "" });
  });
});

describe("readSetupAnswer: text", () => {
  it("writes the trimmed answer onto its key", () => {
    expect(readSetupAnswer(q("q1"), "  Head of design at a startup ")).toEqual({
      answers: { q1: "Head of design at a startup" },
      fact: { text: "Head of design at a startup", kind: "next_role" },
    });
  });

  it("saves the lead win as a result and what's off the table as a dealbreaker", () => {
    expect(readSetupAnswer(q("q4"), "Cut churn 20%").fact.kind).toBe("result");
    expect(readSetupAnswer(q("q5"), "No travel").fact.kind).toBe("dealbreaker");
  });
});

describe("setupFact", () => {
  it("turns saved pay into a fact", () => {
    expect(setupFact(comp, { floor: "140000", target: "180000" })).toEqual({ text: "Pay floor $140,000; would move for $180,000.", kind: "pay" });
    expect(setupFact(comp, { floor: "140000" })).toEqual({ text: "Pay floor $140,000.", kind: "pay" });
    expect(setupFact(comp, { target: "180000" })).toEqual({ text: "would move for $180,000.", kind: "pay" });
  });

  it("returns null for pay that is missing or not a number", () => {
    expect(setupFact(comp, {})).toBeNull();
    expect(setupFact(comp, { floor: "lots" })).toBeNull();
  });

  it("turns saved modes and area into a fact", () => {
    expect(setupFact(where, { modes: ["Hybrid", "Remote"], area: "NYC" })).toEqual({ text: "Works hybrid or remote in NYC", kind: "next_role" });
    expect(setupFact(where, { modes: [], area: "NYC" })).toEqual({ text: "in NYC", kind: "next_role" });
  });

  it("returns null when no modes or area are saved, and ignores modes that aren't a list", () => {
    expect(setupFact(where, {})).toBeNull();
    expect(setupFact(where, { modes: "Remote", area: " " })).toBeNull();
  });

  it("turns a saved text answer into a fact of its kind", () => {
    expect(setupFact(q("q5"), { q5: " No travel " })).toEqual({ text: "No travel", kind: "dealbreaker" });
    expect(setupFact(q("q1"), { q1: "  " })).toBeNull();
  });
});

describe("isAnswered", () => {
  it("checks one question against the saved answers", () => {
    expect(isAnswered(job, comp, { floor: "140000" })).toBe(true);
    expect(isAnswered(job, comp, {})).toBe(false);
    expect(isAnswered(job, q("q1"), { q1: "Head of design" })).toBe(true);
    expect(isAnswered(job, q("q1"), { q1: "" })).toBe(false);
  });
});
