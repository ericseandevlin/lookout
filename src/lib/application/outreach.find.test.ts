import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "@/lib/ai/search";
import type { DraftInputs } from "./draft";

// Search hits per query, page HTML per URL, and the model's answer are set by each test.
let hitsByQuery: (SearchHit[] | Error)[] = [];
const webSearch = vi.fn(async (query: string) => {
  const r = hitsByQuery[webSearch.mock.calls.length - 1] ?? [];
  if (r instanceof Error) throw r;
  return r;
});
vi.mock("@/lib/ai/search", () => ({ webSearch }));
let pages: Record<string, string> = {};
const fetchPage = vi.fn(async (url: string) => {
  if (!(url in pages)) throw new Error("blocked");
  return { url, html: pages[url] };
});
vi.mock("@/lib/ai/fetchPage", () => ({ fetchPage, pageToText: (html: string) => html }));
type People = { people: { name: string; role: string; why: string; message: string; sourceUrls: string[] }[] };
let answer: People = { people: [] };
const completeJSON = vi.fn(async (_req: { user: string }) => answer);
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON }));

const { findOutreach, finishOutreach } = await import("./outreach");
const { emptyUsage } = await import("@/lib/ai/llm");

const inp = {
  name: "Sam",
  email: "sam.applicant@example.com",
  linkedinUrl: null,
  links: [],
  brief: "",
  posting: { company: "Acme", title: "Product Designer", text: "We want a product designer who ships." },
  resume: "Built a design system used by 40 teams.",
} as unknown as DraftInputs;

const hit = (url: string, snippet = "Acme team page"): SearchHit => ({ url, title: "Acme", snippet });
const person = (name: string, role: string, url: string, message = `Hi ${name.split(" ")[0]}, I'm applying for the Product Designer role at Acme. Could we talk for ten minutes?\n\nSam`) => ({
  name,
  role,
  why: "Leads the design team this role joins.",
  message,
  sourceUrls: [url],
});

beforeEach(() => {
  webSearch.mockClear();
  fetchPage.mockClear();
  completeJSON.mockClear();
  hitsByQuery = [];
  pages = {};
  answer = { people: [] };
});

describe("findOutreach", () => {
  it("skips the model call when search finds nothing", async () => {
    expect(await findOutreach(inp, emptyUsage())).toEqual([]);
    expect(webSearch).toHaveBeenCalledTimes(2);
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("searches with the company and role only, never the applicant", async () => {
    await findOutreach(inp, emptyUsage());
    const queries = webSearch.mock.calls.map((c) => c[0]).join(" ");
    expect(queries).toContain("Acme");
    expect(queries).not.toMatch(/Sam|sam\.applicant/);
  });

  it("uses the other query's hits when one search fails, dropping repeats and non-web URLs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    hitsByQuery = [new Error("search down"), [hit("https://acme.example/team"), hit("https://acme.example/team"), hit("mailto:jobs@acme.example")]];
    await findOutreach(inp, emptyUsage());
    const user = completeJSON.mock.calls[0][0].user;
    expect(user.match(/acme\.example\/team/g)).toHaveLength(1);
    expect(user).not.toContain("mailto:");
  });

  it("reads at most 8 sources and fetches at most 4 pages", async () => {
    hitsByQuery = [Array.from({ length: 6 }, (_, i) => hit(`https://a.example/${i}`)), Array.from({ length: 6 }, (_, i) => hit(`https://b.example/${i}`))];
    await findOutreach(inp, emptyUsage());
    const user = completeJSON.mock.calls[0][0].user;
    expect(user.match(/"url":/g)).toHaveLength(8);
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it("never fetches LinkedIn and keeps the excerpt when a page can't be read", async () => {
    hitsByQuery = [[hit("https://www.linkedin.com/in/maya", "Maya Ortiz, Design Director at Acme"), hit("https://blocked.example/team", "Lee Chen, Recruiter at Acme"), hit("https://acme.example/about")]];
    pages = { "https://acme.example/about": "Our design team is led by Jo Park." };
    await findOutreach(inp, emptyUsage());
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual(["https://blocked.example/team", "https://acme.example/about"]);
    const user = completeJSON.mock.calls[0][0].user;
    expect(user).toContain("Maya Ortiz, Design Director at Acme");
    expect(user).toContain("Lee Chen, Recruiter at Acme");
    expect(user).toContain("Our design team is led by Jo Park.");
  });

  it("gives the model the posting and resume but not the applicant's email", async () => {
    hitsByQuery = [[hit("https://acme.example/team")]];
    await findOutreach(inp, emptyUsage());
    const user = completeJSON.mock.calls[0][0].user;
    expect(user).toContain("Applicant: Sam");
    expect(user).toContain("We want a product designer who ships.");
    expect(user).toContain("Built a design system used by 40 teams.");
    expect(user).not.toContain("sam.applicant@example.com");
  });

  it("keeps a person backed by a fetched page", async () => {
    hitsByQuery = [[hit("https://acme.example/team", "Meet the team")]];
    pages = { "https://acme.example/team": "Jo Park is Design Director at Acme." };
    answer = { people: [person("Jo Park", "Design Director", "https://acme.example/team")] };
    const [item] = await findOutreach(inp, emptyUsage());
    expect(item.prompt).toBe("Jo Park · Design Director");
    expect(item.draft.sources[0]).toBe("https://acme.example/team");
  });
});

describe("finishOutreach edge cases", () => {
  const src = { url: "https://acme.example/team", title: "Team", text: "Jo Park is Design Director at Acme." };

  it("keeps a name once", () => {
    const p = person("Jo Park", "Design Director", src.url);
    expect(finishOutreach({ people: [p, { ...p, name: " jo park " }] }, [src], "Acme")).toHaveLength(1);
  });

  it("drops a message over 110 words", () => {
    const long = person("Jo Park", "Design Director", src.url, `Hi Jo, ${"word ".repeat(110)}`);
    expect(finishOutreach({ people: [long] }, [src], "Acme")).toEqual([]);
  });

  it("drops a person whose source doesn't name the company", () => {
    const other = { ...src, text: "Jo Park is Design Director at Globex." };
    expect(finishOutreach({ people: [person("Jo Park", "Design Director", src.url)] }, [other], "Acme")).toEqual([]);
  });
});
