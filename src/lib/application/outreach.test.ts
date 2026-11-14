import { describe, expect, it } from "vitest";
import { finishOutreach, outreachQueries, type PublicSource } from "./outreach";

const source = (name: string, role: string, n = 1): PublicSource => ({
  url: `https://example.com/team/${n}`,
  title: `${name}, ${role} at Acme`,
  text: `${name} is ${role} at Acme, working with the product design team.`,
});

const person = (name: string, role: string, n = 1) => ({
  name,
  role,
  why: `Their ${role.toLowerCase()} work is close to this role.`,
  message: `Hi ${name.split(" ")[0]}, I'm applying for the Product Designer role at Acme. I built a design system used by 40 teams and would value your advice on what your team needs most right now. Would you be open to a short conversation?\n\nBest,\nSam`,
  sourceUrls: [`https://example.com/team/${n}`],
});

describe("finishOutreach", () => {
  it("formats a source-backed person as an editable, draft-only item", () => {
    const [item] = finishOutreach({ people: [person("Maya Ortiz", "Design Director")] }, [source("Maya Ortiz", "Design Director")], "Acme");
    expect(item.prompt).toBe("Maya Ortiz · Design Director");
    expect(item.draft.content).toMatch(/^Hi Maya,/);
    expect(item.draft.note).toContain("Why this person");
    expect(item.draft.note).toContain("never sends");
    expect(item.draft.sources).toEqual(["https://example.com/team/1", "posting", "master resume"]);
    expect(item.draft.question).toBeNull();
  });

  it("checks names in any script against the source (#1172)", () => {
    const madeUp = { ...person("王伟", "Recruiter"), message: person("Wei", "Recruiter").message };
    expect(finishOutreach({ people: [madeUp] }, [source("Jane Smith", "Recruiter")], "Acme")).toEqual([]);
    expect(finishOutreach({ people: [madeUp] }, [source("王伟", "Recruiter")], "Acme").map((i) => i.prompt)).toEqual(["王伟 · Recruiter"]);
    expect(finishOutreach({ people: [person("José Ortiz", "Recruiter")] }, [source("Jose Ortiz", "Recruiter")], "Acme")).toHaveLength(1);
    expect(finishOutreach({ people: [person("Maya Ortiz", "Recruiter")] }, [source("Maya Ortiz", "Recruiter")], "—")).toEqual([]);
  });

  it("caps the list at two people", () => {
    const people = [person("Maya Ortiz", "Design Director", 1), person("Lee Chen", "Recruiter", 2), person("Sam Jones", "Product Lead", 3)];
    const sources = [source("Maya Ortiz", "Design Director", 1), source("Lee Chen", "Recruiter", 2), source("Sam Jones", "Product Lead", 3)];
    expect(finishOutreach({ people }, sources, "Acme")).toHaveLength(2);
  });

  it("drops invented people, roles, sources and personal relationships", () => {
    const good = source("Maya Ortiz", "Design Director");
    const badUrl = { ...person("Maya Ortiz", "Design Director"), sourceUrls: ["https://invented.example/person"] };
    const badRole = person("Maya Ortiz", "Chief Executive");
    const mutual = { ...person("Maya Ortiz", "Design Director"), why: "You two are mutual connections." };
    expect(finishOutreach({ people: [badUrl, badRole, mutual] }, [good], "Acme")).toEqual([]);
  });

  it("returns no item when the model finds nobody usable", () => {
    expect(finishOutreach({ people: [] }, [], "Acme")).toEqual([]);
  });
});

describe("outreachQueries", () => {
  it("uses only the company and target role, not applicant identity", () => {
    const queries = outreachQueries("Acme", "Product Designer");
    expect(queries).toHaveLength(2);
    expect(queries.join(" ")).toContain("Acme");
    expect(queries.join(" ")).toContain("Product Designer");
    expect(queries.join(" ")).not.toContain("Sam Applicant");
  });
});
