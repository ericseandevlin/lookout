import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { kinds } from "@/lib/kinds";

// Which searches a scheduler pass runs (#377). An in-process Postgres with the real migrations stands in for
// the app database; the advisory lock gets its own fake connection (lock behavior is in scheduler.test.ts).
const pg = new PGlite();
const db = drizzle(pg, { schema });
const lockConn = Object.assign(async () => [{ locked: true }], { release: () => {} });
vi.mock("@/lib/db", () => ({ db, schema, sqlClient: { reserve: async () => lockConn } }));
vi.mock("@/lib/config", () => ({ getAiConfig: async () => ({ provider: "anthropic", model: "test-model" }) }));
vi.mock("@/lib/retention", () => ({ cleanup: async () => ({ loginTokens: 0, sessions: 0, runLogs: 0, errors: 0, inactiveWarned: 0 }) }));
const recordError = vi.fn(async () => {});
vi.mock("@/lib/errorLog", () => ({ recordError }));
const discover = vi.fn(async (searchId: string) => ({ runId: `run-${searchId}` }));
const isRunning = vi.fn(async () => false);
vi.mock("@/lib/agent/discover", () => ({ discover, isRunning }));
const sendDigest = vi.fn(async () => {});
vi.mock("@/lib/digest", () => ({ sendDigest }));
const sweepApplications = vi.fn(async () => {});
vi.mock("@/lib/application/run", () => ({ sweepApplications }));

const { tick } = await import("./scheduler");
const { BudgetError } = await import("@/lib/ai/runs");

// Monday 2026-11-09, noon in New York (the default APP_TZ).
const MON_NOON = new Date("2026-11-09T17:00:00Z");
const HOUR = 3600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR);

/** Every question of the job kind answered, so setup counts as complete. */
function fullAnswers() {
  const a: Record<string, string | string[]> = {};
  for (const q of kinds.job.questions) {
    if (q.kind === "text") a[q.key] = "Design systems lead";
    else if (q.kind === "comp") a[q.floorKey] = "150000";
    else a[q.modesKey] = ["Remote"];
  }
  return a;
}

let seq = 0;
type Seed = { freq?: "Daily" | "Twice a week" | "Weekly"; runDay?: string; runDays?: string[]; disabled?: boolean; kind?: string; answers?: Record<string, string | string[]>; resume?: "done" | "scanning" | null };
async function seed(o: Seed = {}) {
  const [user] = await db.insert(schema.users).values({ email: `u${++seq}@example.com`, disabled: o.disabled ?? false }).returning();
  const [search] = await db
    .insert(schema.searches)
    .values({ userId: user.id, name: "Job search", kind: o.kind ?? "job", answers: o.answers ?? fullAnswers() })
    .returning();
  await db.insert(schema.settings).values({ userId: user.id, activeSearchId: search.id, freq: o.freq ?? "Weekly", runDay: o.runDay ?? "Mon", runDays: o.runDays ?? ["Mon", "Thu"] });
  const resume = o.resume === undefined ? "done" : o.resume;
  if (resume) await db.insert(schema.materials).values({ userId: user.id, kind: "resume", status: resume });
  return { userId: user.id, searchId: search.id };
}

async function addRun(s: { userId: string; searchId: string }, r: { trigger?: "scheduled" | "manual" | "url"; status: "running" | "queued" | "done" | "failed"; hoursAgo: number }) {
  const [run] = await db
    .insert(schema.runs)
    .values({ userId: s.userId, searchId: s.searchId, trigger: r.trigger ?? "scheduled", status: r.status, startedAt: ago(r.hoursAgo) })
    .returning();
  return run;
}

const ran = () => discover.mock.calls.map((c) => c[0]);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  vi.useRealTimers();
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MON_NOON);
  discover.mockClear();
  discover.mockImplementation(async (searchId: string) => ({ runId: `run-${searchId}` }));
  isRunning.mockReset();
  isRunning.mockResolvedValue(false);
  sendDigest.mockClear();
  sweepApplications.mockClear();
  recordError.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("which searches a pass runs (#377)", () => {
  it("runs a complete search that has never run, even off its run day", async () => {
    const s = await seed({ runDay: "Fri" });
    await tick();
    expect(ran()).toEqual([s.searchId]);
    expect(discover).toHaveBeenCalledWith(s.searchId, "scheduled");
    expect(sendDigest).toHaveBeenCalledWith(s.userId, `run-${s.searchId}`);
  });

  it("skips disabled users, unfinished setup, and accounts without a scanned resume", async () => {
    await seed({ disabled: true });
    await seed({ answers: {} });
    await seed({ resume: null });
    await seed({ resume: "scanning" });
    await tick();
    expect(ran()).toEqual([]);
  });

  it("skips a kind with no discovery source (rfp without a SAM.gov key)", async () => {
    await seed({ kind: "rfp" });
    await tick();
    expect(ran()).toEqual([]);
  });

  it("skips a user whose run is still going", async () => {
    await seed();
    isRunning.mockResolvedValue(true);
    await tick();
    expect(ran()).toEqual([]);
  });

  it("backs off for 2 hours after a failed run, then tries again", async () => {
    const s = await seed();
    await addRun(s, { status: "failed", hoursAgo: 1 });
    await tick();
    expect(ran()).toEqual([]);

    vi.setSystemTime(new Date(MON_NOON.getTime() + 2 * HOUR));
    await tick();
    expect(ran()).toEqual([s.searchId]);
  });

  it("after the first run, runs again on the run day once per 20 hours", async () => {
    const s = await seed({ runDay: "Mon" });
    const last = await addRun(s, { status: "done", hoursAgo: 7 * 24 });
    await tick();
    expect(ran()).toEqual([s.searchId]);

    discover.mockClear();
    await db.update(schema.runs).set({ startedAt: ago(19) }).where(eq(schema.runs.id, last.id));
    await tick();
    expect(ran()).toEqual([]);
  });

  it("waits until 7am local time on the run day", async () => {
    const s = await seed({ runDay: "Mon" });
    await addRun(s, { status: "done", hoursAgo: 7 * 24 });
    vi.setSystemTime(new Date("2026-11-09T11:30:00Z")); // 6:30am in New York
    await tick();
    expect(ran()).toEqual([]);

    vi.setSystemTime(new Date("2026-11-09T12:00:00Z")); // 7am
    await tick();
    expect(ran()).toEqual([s.searchId]);
  });

  it("follows Daily, Twice a week and weekly run days", async () => {
    const daily = await seed({ freq: "Daily", runDay: "Fri" });
    const twiceOn = await seed({ freq: "Twice a week", runDays: ["Mon", "Thu"] });
    const twiceOff = await seed({ freq: "Twice a week", runDays: ["Tue", "Fri"] });
    const weeklyOff = await seed({ freq: "Weekly", runDay: "Wed" });
    for (const s of [daily, twiceOn, twiceOff, weeklyOff]) await addRun(s, { status: "done", hoursAgo: 48 });
    await tick();
    expect(ran().sort()).toEqual([daily.searchId, twiceOn.searchId].sort());
  });

  it("counts a manual run as the first run, but only scheduled runs toward the 20 hours", async () => {
    const s = await seed({ runDay: "Mon" });
    await addRun(s, { trigger: "manual", status: "done", hoursAgo: 2 });
    await tick();
    expect(ran()).toEqual([s.searchId]);
  });

  it("treats a search whose only runs failed long ago as never run", async () => {
    const s = await seed({ runDay: "Fri" });
    await addRun(s, { status: "failed", hoursAgo: 30 });
    await tick();
    expect(ran()).toEqual([s.searchId]);
  });
});

describe("the rest of a pass (#377)", () => {
  it("closes out runs stuck running for 45 minutes or queued for a day", async () => {
    const s = await seed({ resume: null });
    const stuck = await addRun(s, { status: "running", hoursAgo: 1 });
    const live = await addRun(s, { status: "running", hoursAgo: 0.5 });
    const lost = await addRun(s, { status: "queued", hoursAgo: 25 });
    const waiting = await addRun(s, { status: "queued", hoursAgo: 2 });
    await tick();
    const byId = new Map((await db.select().from(schema.runs)).map((r) => [r.id, r]));
    expect(byId.get(stuck.id)).toMatchObject({ status: "failed", error: "Interrupted" });
    expect(byId.get(live.id)?.status).toBe("running");
    expect(byId.get(lost.id)).toMatchObject({ status: "failed", error: "The search agent never picked this up" });
    expect(byId.get(waiting.id)?.status).toBe("queued");
    expect(sweepApplications).toHaveBeenCalledOnce();
  });

  it("stops the pass on a budget cap instead of failing every search", async () => {
    await seed();
    await seed();
    discover.mockRejectedValue(new BudgetError("Daily cap reached"));
    await tick();
    expect(discover).toHaveBeenCalledOnce();
    expect(recordError).not.toHaveBeenCalled();
  });

  it("logs any other failure to Admin > Errors and moves on to the next search", async () => {
    const a = await seed();
    const b = await seed();
    discover.mockRejectedValueOnce(new Error("boom"));
    await tick();
    expect(ran().sort()).toEqual([a.searchId, b.searchId].sort());
    expect(recordError).toHaveBeenCalledOnce();
    expect(recordError.mock.calls[0]).toEqual(["scheduler", expect.any(Error), { path: expect.stringContaining("run failed for search") }]);
    expect(sendDigest).toHaveBeenCalledOnce();
  });
});
