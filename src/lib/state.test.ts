import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { RunReport } from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { getLatestRun, getState } = await import("./state");

let user: typeof schema.users.$inferSelect;
let jobs = "";
let rfps = "";
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 10, day, hour));
const REPORT: RunReport = { queries: ["design director"], results: 10, picked: 4, read: 3, tally: { postings: 3, notPostings: 0, known: 1, dealbreaker: 0, belowFloor: 0, offLocation: 0, added: 2 }, tips: [] };

async function addFind(searchId: string, company: string, over: Partial<typeof schema.userOpportunities.$inferInsert> = {}, opp: Partial<typeof schema.opportunities.$inferInsert> = {}) {
  const [o] = await db
    .insert(schema.opportunities)
    .values({ company, title: "Director of Design", location: "New York, NY", sourceUrl: `https://jobs.example.com/${company}`, fingerprint: `${company}-${searchId}`, ...opp })
    .returning();
  await db.insert(schema.userOpportunities).values({ userId: user.id, searchId, opportunityId: o.id, score: 4, ...over });
  return o;
}

const addRun = (searchId: string, trigger: "scheduled" | "manual" | "url" | "resume" | "events", status: "queued" | "running" | "done" | "failed", day: number, over: Partial<typeof schema.runs.$inferInsert> = {}) =>
  db
    .insert(schema.runs)
    .values({ userId: user.id, searchId, trigger, status, startedAt: at(day), finishedAt: status === "done" ? at(day, 13) : null, ...over })
    .returning()
    .then((r) => r[0]);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  [user] = await db.insert(schema.users).values({ email: "a@example.com", name: "Ann" }).returning();
  const [j] = await db.insert(schema.searches).values({ userId: user.id, name: "Job search", answers: { q1: "A step up" }, createdAt: at(1) }).returning();
  const [r] = await db.insert(schema.searches).values({ userId: user.id, name: "RFP search", kind: "rfp", answers: { q1: "City contracts" }, createdAt: at(2) }).returning();
  jobs = j.id;
  rfps = r.id;
});

describe("getState", () => {
  it("returns defaults and the first search when nothing is set", async () => {
    const s = await getState(user);
    expect(s.settings).toEqual({ freq: "Weekly", day: "Mon", days: ["Mon", "Thu"], digest: true, density: "Comfortable", setup: "Until complete", newDays: 7, railClosed: false });
    expect(s.user).toMatchObject({ name: "Ann", email: "a@example.com" });
    expect(s.searches.map((x) => x.name)).toEqual(["Job search", "RFP search"]);
    expect(s.searchId).toBe(jobs);
    expect(s.profile).toMatchObject({ kind: "job", answers: { q1: "A step up" }, savedAt: null });
    expect(s).toMatchObject({ finds: [], lastRunAt: null, lastReport: null, running: null, run: null });
    expect(s.materials).toEqual({ resume: null, linkedin: { handle: "", linked: false, pdf: null }, links: [] });
  });

  it("shows only the active search's finds, newest first", async () => {
    await addFind(jobs, "Acme", { addedAt: at(3) });
    await addFind(jobs, "Beta", { addedAt: at(5) });
    await addFind(rfps, "City", { addedAt: at(6) });
    expect((await getState(user)).finds.map((f) => f.company)).toEqual(["Beta", "Acme"]);
    await db.insert(schema.settings).values({ userId: user.id, activeSearchId: rfps, freq: "Daily" });
    const s = await getState(user);
    expect(s.searchId).toBe(rfps);
    expect(s.profile.kind).toBe("rfp");
    expect(s.settings.freq).toBe("Daily");
    expect(s.finds.map((f) => f.company)).toEqual(["City"]);
  });

  it("maps a find: one-sided pay becomes a range, Not a fit shows its reason, seen and application come through", async () => {
    const o = await addFind(jobs, "Acme", { feedback: { reason: "Too junior", at: at(4).toISOString() }, seenAt: at(4), notes: "Ask Sam" }, { compMin: 180000 });
    await addFind(jobs, "Beta", { addedAt: at(1) });
    await db.insert(schema.applications).values({ userId: user.id, opportunityId: o.id, status: "ready" });
    const [acme, beta] = (await getState(user)).finds;
    expect(acme).toMatchObject({ company: "Acme", role: "Director of Design", comp: [180000, 180000], feedback: "Too junior", seen: true, notes: "Ask Sam", stage: "Not applied" });
    expect(acme.application).toMatchObject({ status: "ready", queuedBy: "user" });
    expect(beta).toMatchObject({ comp: null, feedback: null, seen: false, application: null });
  });

  it("reports the newest finished search, ignoring link adds and resume scans", async () => {
    await addRun(jobs, "scheduled", "done", 2, { report: REPORT, added: 2 });
    await addRun(jobs, "manual", "failed", 3);
    await addRun(jobs, "url", "done", 4, { report: REPORT, added: 1 });
    await addRun(jobs, "resume", "done", 5);
    await addRun(rfps, "manual", "done", 6, { report: REPORT });
    const s = await getState(user);
    expect(s.lastRunAt).toBe(at(2, 13).toISOString());
    expect(s.lastReport).toEqual({ at: at(2, 13).toISOString(), added: 2, report: REPORT });
    expect(s.running).toBeNull();
  });

  it("marks a search as running while it is queued or running", async () => {
    await addRun(jobs, "scheduled", "done", 2);
    await addRun(jobs, "manual", "queued", 3);
    expect((await getState(user)).running).toBe("manual");
  });

  it("lists materials in position order", async () => {
    await db.insert(schema.materials).values([
      { userId: user.id, kind: "link", url: "https://b.example.com", position: 2, status: "done" },
      { userId: user.id, kind: "link", url: "https://a.example.com", position: 1, linkKind: "Portfolio" },
      { userId: user.id, kind: "resume", fileName: "cv.pdf", filledNote: "Filled 2 answers" },
      { userId: user.id, kind: "linkedin", url: "ann", fileKey: "k", scannedAt: at(3), extracted: { uploadedAt: "2026-11-03T00:00:00.000Z" } },
    ]);
    const m = (await getState(user)).materials;
    expect(m.resume).toMatchObject({ name: "cv.pdf", status: "done", filled: "Filled 2 answers" });
    expect(m.linkedin).toEqual({ handle: "ann", linked: true, pdf: { name: "LinkedIn.pdf", uploadedAt: "2026-11-03T00:00:00.000Z" } });
    expect(m.links).toEqual([
      { id: expect.any(String), url: "https://a.example.com", kind: "Portfolio", status: null, note: null },
      { id: expect.any(String), url: "https://b.example.com", kind: null, status: "done", note: null },
    ]);
  });
});

describe("getLatestRun", () => {
  it("is null with no runs, and follows an active search over a newer finished one", async () => {
    expect(await getLatestRun(jobs)).toBeNull();
    const active = await addRun(jobs, "scheduled", "running", 2, { progress: { pct: 40, step: "Reading pages", log: [] } });
    await addRun(jobs, "url", "done", 3);
    await addRun(jobs, "resume", "running", 4);
    expect(await getLatestRun(jobs)).toMatchObject({ id: active.id, status: "running", pct: 40, step: "Reading pages", finishedAt: null, report: null });
  });
});
