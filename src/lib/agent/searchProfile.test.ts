import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { SearchProfile } from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

let provider = "openai";
vi.mock("@/lib/config", () => ({ getAiConfig: async () => ({ provider, model: "test-model" }) }));
const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`);
const MODEL_OUT = {
  summary: "You lead design teams.",
  targetTitles: many(12, "Title"),
  seniority: "Director to VP",
  industries: many(9, "Industry"),
  strengths: many(10, "Strength"),
  proof: many(6, "Proof"),
  where: "New York; hybrid",
  pay: "Not given",
  avoid: many(10, "Avoid"),
  searchTerms: many(14, "term"),
  corrections: many(10, "Correction"),
};
const completeJSON = vi.fn<(req?: { user: string }) => Promise<typeof MODEL_OUT>>(async () => MODEL_OUT);
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON: (req: { user: string }) => completeJSON(req) }));

const { AiConfigError, emptyUsage } = await import("@/lib/ai/llm");
const { ensureSearchProfile, renderSearchProfile } = await import("./searchProfile");

let userId = "";
let searchId = "";
const ensure = (opts?: { force?: boolean; build?: boolean }) => ensureSearchProfile(searchId, emptyUsage(), opts);
const setAnswers = (answers: Record<string, string>) => db.update(schema.searches).set({ answers }).where(eq(schema.searches.id, searchId));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  provider = "openai";
  completeJSON.mockClear();
  completeJSON.mockImplementation(async () => MODEL_OUT);
  await db.delete(schema.users);
  const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
  const [s] = await db.insert(schema.searches).values({ userId: u.id, name: "Job search", answers: { q1: "A step up" } }).returning();
  userId = u.id;
  searchId = s.id;
});

describe("ensureSearchProfile", () => {
  it("builds once and reuses it while the inputs are the same", async () => {
    const first = await ensure();
    expect(first.rebuilt).toBe(true);
    const [s] = await db.select().from(schema.searches);
    expect(s.searchProfileHash).toBe(first.raw.hash);
    const second = await ensure();
    expect(second.rebuilt).toBe(false);
    expect(second.profile).toEqual(first.profile);
    expect(completeJSON).toHaveBeenCalledOnce();
  });

  it("rebuilds when an answer, the resume or a note on a find changes, and when forced", async () => {
    await ensure();
    await setAnswers({ q1: "A bigger role" });
    expect((await ensure()).rebuilt).toBe(true);
    await db.insert(schema.materials).values({ userId, kind: "resume", extracted: { text: "Ten years leading design." } });
    expect((await ensure()).rebuilt).toBe(true);
    const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title: "Designer", fingerprint: "acme" }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId, opportunityId: o.id, score: 70, notes: "I have banking experience." });
    expect((await ensure()).rebuilt).toBe(true);
    expect((await ensure()).rebuilt).toBe(false);
    expect((await ensure({ force: true })).rebuilt).toBe(true);
    expect(completeJSON).toHaveBeenCalledTimes(5);
  });

  it("makes no call when there's nothing to build from", async () => {
    await setAnswers({});
    const r = await ensure();
    expect(r).toMatchObject({ profile: null, rebuilt: false });
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("returns the stored profile without a call when building is off or the provider is the agent", async () => {
    await ensure();
    await setAnswers({ q1: "A bigger role" });
    const off = await ensure({ build: false });
    expect(off.rebuilt).toBe(false);
    expect(off.profile?.summary).toBe("You lead design teams.");
    provider = "agent";
    expect((await ensure()).profile?.summary).toBe("You lead design teams.");
    expect(completeJSON).toHaveBeenCalledOnce();
  });

  it("keeps the stored profile when the model fails", async () => {
    await ensure();
    await setAnswers({ q1: "A bigger role" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    completeJSON.mockRejectedValueOnce(new Error("timeout"));
    const r = await ensure();
    expect(r).toMatchObject({ rebuilt: false, error: "Couldn't update it just now" });
    expect(r.profile?.summary).toBe("You lead design teams.");
    completeJSON.mockRejectedValueOnce(new AiConfigError("no key"));
    const quiet = await ensure();
    expect(quiet.rebuilt).toBe(false);
    expect(quiet).not.toHaveProperty("error");
    // A failed build doesn't store the new hash, so the next run tries again.
    expect((await ensure()).rebuilt).toBe(true);
  });

  it("trims long lists from the model", async () => {
    const { profile } = await ensure();
    expect(profile).toMatchObject({
      targetTitles: { length: 8 },
      industries: { length: 6 },
      strengths: { length: 8 },
      proof: { length: 4 },
      avoid: { length: 8 },
      searchTerms: { length: 10 },
      corrections: { length: 8 },
    });
  });
});

describe("what the model is given (#581)", () => {
  const prompt = () => completeJSON.mock.calls.at(-1)![0]!.user;
  const find = async (title: string, notes: string, search = searchId) => {
    const [o] = await db.insert(schema.opportunities).values({ company: "Acme", title, fingerprint: crypto.randomUUID() }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId: search, opportunityId: o.id, score: 70, notes, reasonsMatch: ["Leads design teams"], reasonsGap: ["New to banking"] });
  };

  it("throws for a search that doesn't exist", async () => {
    await expect(ensureSearchProfile(crypto.randomUUID(), emptyUsage())).rejects.toThrow("Search not found");
  });

  it("says there's no resume, and leaves out LinkedIn, links and notes when there are none", async () => {
    await ensure();
    expect(prompt()).toContain("A step up");
    expect(prompt()).toContain("<resume>\n(none)\n</resume>");
    expect(prompt()).not.toMatch(/linkedin_profile|their_links|their_notes_on_finds/);
  });

  it("sends the resume summary and text, LinkedIn, links with text, and this search's notes with their bullets", async () => {
    await db.insert(schema.materials).values([
      { userId, kind: "resume", extracted: { summary: "Design leader.", text: "Ten years leading design." } },
      { userId, kind: "linkedin", extracted: { text: "Head of Design at Acme" } },
      ...[1, 2, 3, 4, 5].map((n) => ({ userId, kind: "link" as const, url: `https://site${n}.example`, extracted: { text: `Site ${n}` }, position: n })),
      { userId, kind: "link", url: "https://unread.example", position: 0 },
    ]);
    await find("Designer", "I have banking experience.");
    await find("Engineer", "");
    const [other] = await db.insert(schema.searches).values({ userId, name: "Other" }).returning();
    await find("Writer", "A note for another search", other.id);

    const { raw } = await ensure();
    expect(prompt()).toContain("<resume>\nDesign leader.\n\nTen years leading design.\n</resume>");
    expect(prompt()).toContain("<linkedin_profile>\nHead of Design at Acme\n</linkedin_profile>");
    expect(prompt()).toContain("https://site4.example\nSite 4");
    expect(prompt()).not.toMatch(/site5|unread/);
    expect(prompt()).toContain('Find: "Designer" at Acme\nLookout said: + Leads design teams | - New to banking\nTheir note: I have banking experience.');
    expect(prompt()).not.toMatch(/Engineer|another search/);
    expect(raw.sources).toEqual({ answers: 1, resume: true, linkedin: true, links: 4, notes: 1 });
  });

  it("uses the links in the order the person sees them, so re-reading one doesn't change the set or rebuild (#966)", async () => {
    await db.insert(schema.materials).values([5, 4, 3, 2, 1].map((n) => ({ userId, kind: "link" as const, url: `https://site${n}.example`, extracted: { text: `Site ${n}` }, position: n })));
    const first = await ensure();
    expect(first.raw.links.map((l) => l.url)).toEqual([1, 2, 3, 4].map((n) => `https://site${n}.example`));
    // A re-read rewrites the row, and Postgres moves it to the end of the table.
    for (const n of [1, 2]) {
      await db.update(schema.materials).set({ scannedAt: new Date() }).where(eq(schema.materials.url, `https://site${n}.example`));
    }
    const second = await ensure();
    expect(second.raw.links.map((l) => l.url)).toEqual(first.raw.links.map((l) => l.url));
    expect(second.rebuilt).toBe(false);
    expect(completeJSON).toHaveBeenCalledOnce();
  });

  it("leaves out Lookout's own closed line, and notes that are only that or blank (#792)", async () => {
    const closed = "Closed: the posting was gone (page says it's closed) as of 2026-11-01. Lookout archived it.";
    await find("Designer", `Ask Sam about this.\n\n${closed}`);
    await find("Engineer", closed);
    await find("Writer", "   ");
    const { raw } = await ensure();
    expect(prompt()).toContain('Find: "Designer" at Acme\nLookout said: + Leads design teams | - New to banking\nTheir note: Ask Sam about this.\n');
    expect(prompt()).not.toMatch(/Engineer|Writer|Lookout archived it/);
    expect(raw.sources.notes).toBe(1);

    // A posting closing later doesn't change what the profile is built from, so it doesn't rebuild.
    const before = raw.hash;
    await find("Analyst", closed);
    expect((await ensure()).raw.hash).toBe(before);
  });

  it("uses the resume text when the summary step never ran, and counts only answers with something in them", async () => {
    await db.insert(schema.materials).values({ userId, kind: "resume", extracted: { text: "Ten years leading design." } });
    await db.update(schema.searches).set({ answers: { q1: "A step up", q2: ["Remote", "Hybrid"], q3: [], q4: "  " } }).where(eq(schema.searches.id, searchId));
    const { raw } = await ensure();
    expect(raw.resume).toBe("Ten years leading design.");
    expect(raw.sources.answers).toBe(2);
  });
});

describe("renderSearchProfile", () => {
  const p: SearchProfile = {
    summary: "You lead design teams.",
    targetTitles: ["Head of Design", "Design Director"],
    seniority: "Director",
    industries: [],
    strengths: ["Design systems"],
    proof: ["Cut build time 40%", "Grew team to 12"],
    where: "Remote",
    pay: "Not given",
    avoid: [],
    searchTerms: ["design", "systems"],
  };

  it("prints each field, with defaults for empty lists and no corrections line", () => {
    const out = renderSearchProfile(p);
    expect(out).toContain("Target titles: Head of Design; Design Director");
    expect(out).toContain("Industries: open");
    expect(out).toContain("Proof: Cut build time 40% | Grew team to 12");
    expect(out).toContain("Avoid: nothing stated");
    expect(out).toContain("Search terms: design, systems");
    expect(out).not.toContain("Corrections");
  });

  it("adds the corrections line when there are some", () => {
    expect(renderSearchProfile({ ...p, corrections: ["Banking is not new to them"] })).toMatch(/^Corrections from them .*: Banking is not new to them$/m);
  });
});
