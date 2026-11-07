import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

type Req = { name: string; system: string; user: string };
type Find = { index: number; score: number; reasons_match: string[]; reasons_gap: string[]; location_fit: boolean; dealbreaker: boolean };
const fit = (index: number, over: Partial<Find> = {}): Find => ({ index, score: 4, reasons_match: ["Event work you do"], reasons_gap: [], location_fit: true, dealbreaker: false, ...over });
// The model: by default every notice in a batch scores 4.
const completeJSON = vi.fn(async (req: Req) => ({ finds: [...req.user.matchAll(/^\[(\d+)\]$/gm)].map((m) => fit(Number(m[1]))) }));
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON }));
// The search profile is built by its own tests; here there isn't one.
vi.mock("./searchProfile", async (orig) => ({ ...(await orig<typeof import("./searchProfile")>()), ensureSearchProfile: vi.fn(async () => ({ profile: null, rebuilt: false })) }));

const { discoverRfp } = await import("./rfp");

const ymd = (days: number) => new Date(Date.now() + days * 24 * 3600_000).toISOString().slice(0, 10);

/** One SAM.gov record, open and due in two weeks. */
const notice = (id: string, over: Record<string, unknown> = {}) => ({
  noticeId: id,
  title: `Event Production ${id}`,
  fullParentPathName: "GENERAL SERVICES ADMINISTRATION.PUBLIC BUILDINGS SERVICE",
  postedDate: ymd(-3),
  type: "Solicitation",
  typeOfSetAside: null,
  typeOfSetAsideDescription: null,
  responseDeadLine: `${ymd(14)}T17:00:00-05:00`,
  naicsCode: "561920",
  active: "Yes",
  award: null,
  placeOfPerformance: { city: { name: "New York" }, state: { code: "NY" } },
  uiLink: `https://sam.gov/opp/${id}/view`,
  ...over,
});

let sam: (url: URL) => Response;
const fetchMock = vi.fn(async (input: string | URL | Request) => sam(new URL(String(input))));
let userId: string;
let searchId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  completeJSON.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SAM_API_KEY", "k".repeat(40));
  sam = () => Response.json({ totalRecords: 2, opportunitiesData: [notice("n1"), notice("n2")] });
  await db.delete(schema.runs);
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "me@example.com", name: "Pat Lee" }).returning();
  [{ id: searchId }] = await db.insert(schema.searches).values({ userId, name: "Bids", kind: "rfp", answers: { naics: "561920" } }).returning();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const board = () =>
  db
    .select()
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.searchId, searchId));
const runs = () => db.select().from(schema.runs).where(eq(schema.runs.userId, userId));

describe("discoverRfp (#272)", () => {
  it("needs a SAM.gov key and starts no run without one", async () => {
    vi.stubEnv("SAM_API_KEY", "");
    await expect(discoverRfp(searchId, userId, "manual")).rejects.toThrow("SAM_API_KEY");
    expect(await runs()).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("scores open notices and saves them as rfp finds on the search", async () => {
    const out = await discoverRfp(searchId, userId, "manual");
    expect(out).toMatchObject({ found: 2, added: 2 });

    const rows = await board();
    expect(rows.map((r) => r.opportunities.fingerprint).sort()).toEqual(["sam:n1", "sam:n2"]);
    const [r] = rows;
    expect(r.opportunities.type).toBe("rfp");
    expect(r.opportunities.company).toBe("Public Buildings Service");
    expect(r.opportunities.attributes).toMatchObject({ due: ymd(14), source: "sam.gov" });
    expect(r.user_opportunities).toMatchObject({ userId, score: 4, addedVia: "agent" });

    const [run] = await runs();
    expect(run).toMatchObject({ id: out.runId, status: "done", found: 2, added: 2, searchId });
    // The key goes to SAM.gov and only there.
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("api_key")).toBe("k".repeat(40));
    expect(url.searchParams.get("ncode")).toBe("561920");
  });

  it("tells the model today's date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-03-04T15:00:00Z"));
      sam = () => Response.json({ opportunitiesData: [notice("n1")] });
      await discoverRfp(searchId, userId, "manual");
      expect(completeJSON.mock.calls[0][0].system).toContain("Today is 2031-03-04.");
    } finally {
      vi.useRealTimers();
    }
  });

  it("doesn't score a notice already on the board again", async () => {
    await discoverRfp(searchId, userId, "scheduled");
    completeJSON.mockClear();
    sam = () => Response.json({ opportunitiesData: [notice("n1"), notice("n2"), notice("n3")] });
    const out = await discoverRfp(searchId, userId, "scheduled");
    expect(out).toMatchObject({ found: 1, added: 1 });
    const user = completeJSON.mock.calls[0][0].user;
    expect(user).toContain("Event Production n3");
    expect(user).not.toContain("Event Production n1");
  });

  it("leaves out dealbreakers", async () => {
    completeJSON.mockImplementationOnce(async () => ({ finds: [fit(0), fit(1, { dealbreaker: true, score: 1 })] }));
    const out = await discoverRfp(searchId, userId, "manual");
    expect(out.added).toBe(1);
    expect((await board()).map((r) => r.opportunities.fingerprint)).toEqual(["sam:n1"]);
  });

  it("keeps going when SAM.gov fails one query", async () => {
    await db.update(schema.searches).set({ answers: { naics: "561920, 711310" } }).where(eq(schema.searches.id, searchId));
    sam = (url) => (url.searchParams.get("ncode") === "711310" ? new Response("busy", { status: 503 }) : Response.json({ opportunitiesData: [notice("n1")] }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await discoverRfp(searchId, userId, "manual");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.added).toBe(1);
    // The logged error never carries the URL, since it holds the key.
    expect(JSON.stringify(err.mock.calls)).not.toContain("k".repeat(40));
    err.mockRestore();
  });

  it("saves nothing from a batch the model fails on, and still finishes the run", async () => {
    completeJSON.mockRejectedValueOnce(new Error("model down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await discoverRfp(searchId, userId, "manual");
    err.mockRestore();
    expect(out).toMatchObject({ found: 0, added: 0 });
    expect((await runs())[0].status).toBe("done");
  });
});
