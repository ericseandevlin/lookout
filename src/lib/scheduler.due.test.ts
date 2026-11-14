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
const isRunning = vi.fn<(userId: string) => Promise<boolean>>(async () => false);
vi.mock("@/lib/agent/discover", () => ({ discover, isRunning }));
const sendDigest = vi.fn(async () => {});
vi.mock("@/lib/digest", () => ({ sendDigest }));
const sweepApplications = vi.fn(async () => {});
vi.mock("@/lib/spendAlerts", () => ({ checkKeyLimit: async () => {} }));
vi.mock("@/lib/application/run", () => ({ sweepApplications }));

const { tick } = await import("./scheduler");
const { BudgetError } = await import("@/lib/ai/runs");
const { USER_CAP_MESSAGE } = await import("@/lib/spend");

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

  it("tries the run day again after a scheduled run that failed or was interrupted (#790)", async () => {
    const s = await seed({ runDay: "Mon" });
    await addRun(s, { status: "done", hoursAgo: 7 * 24 });
    await addRun(s, { status: "failed", hoursAgo: 1 });
    await tick();
    expect(ran()).toEqual([]);

    vi.setSystemTime(new Date(MON_NOON.getTime() + 2 * HOUR));
    await tick();
    expect(ran()).toEqual([s.searchId]);
  });

  it("after the first run, runs once per run day (#1222)", async () => {
    const s = await seed({ runDay: "Mon" });
    const last = await addRun(s, { status: "done", hoursAgo: 7 * 24 });
    await tick();
    expect(ran()).toEqual([s.searchId]);

    // A run earlier today (9am Monday) is today's run.
    discover.mockClear();
    await db.update(schema.runs).set({ startedAt: ago(3) }).where(eq(schema.runs.id, last.id));
    await tick();
    expect(ran()).toEqual([]);

    // A run yesterday evening (5pm Sunday, 19 hours ago) is not.
    discover.mockClear();
    await db.update(schema.runs).set({ startedAt: ago(19) }).where(eq(schema.runs.id, last.id));
    await tick();
    expect(ran()).toEqual([s.searchId]);
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
    for (let i = 0; i < 5; i++) await seed();
    discover.mockRejectedValue(new BudgetError("Daily cap reached"));
    await tick();
    // The three already started end on the cap themselves; nothing new starts (#988).
    expect(discover).toHaveBeenCalledTimes(3);
    expect(recordError).not.toHaveBeenCalled();
  });

  it("with one slot, stops at the first budget cap", async () => {
    process.env.SCHEDULER_CONCURRENCY = "1";
    try {
      await seed();
      await seed();
      discover.mockRejectedValue(new BudgetError("Daily cap reached"));
      await tick();
      expect(discover).toHaveBeenCalledOnce();
    } finally {
      delete process.env.SCHEDULER_CONCURRENCY;
    }
  });

  it("skips a person at their own cap, tells them once on their board, and runs the next person (#990)", async () => {
    const a = await seed();
    const b = await seed();
    discover.mockImplementation(async (searchId: string) => {
      if (searchId === a.searchId) throw new BudgetError("cap", "user");
      return { runId: `run-${searchId}` };
    });
    await tick();
    expect(ran().sort()).toEqual([a.searchId, b.searchId].sort());
    const notes = await db.select().from(schema.runs).where(eq(schema.runs.searchId, a.searchId));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ status: "failed", trigger: "scheduled", error: USER_CAP_MESSAGE, request: { skipped: "user_cap" } });
    // After the 2-hour back-off it is due again and still capped: no second note the same day.
    await db.update(schema.runs).set({ startedAt: ago(3) }).where(eq(schema.runs.searchId, a.searchId));
    await tick();
    expect(await db.select().from(schema.runs).where(eq(schema.runs.searchId, a.searchId))).toHaveLength(1);
    expect(recordError).not.toHaveBeenCalled();
  });

  it("sends no email for a run only queued for the search agent; its complete route does (#1039)", async () => {
    await seed();
    discover.mockImplementationOnce(async () => ({ found: 0, added: 0, queued: true }) as never);
    await tick();
    expect(discover).toHaveBeenCalledOnce();
    expect(sendDigest).not.toHaveBeenCalled();
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

describe("running due searches side by side (#988)", () => {
  it("skips a person whose run started while their search waited for a slot (#1020)", async () => {
    const all = [];
    for (let i = 0; i < 4; i++) all.push(await seed());
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const started = new Set<string>();
    discover.mockImplementation(async (searchId: string) => {
      await gate;
      return { runId: `run-${searchId}` };
    });
    // Not running when the due list is built; running once they press Search now during the pass.
    isRunning.mockImplementation(async (userId: string) => started.has(userId));
    const pass = tick();
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(3));
    const waiting = all.find((s) => !ran().includes(s.searchId))!;
    started.add(waiting.userId);
    release();
    await pass;
    expect(discover).toHaveBeenCalledTimes(3);
    expect(ran()).not.toContain(waiting.searchId);
  });

  it("runs at most 3 at once and still runs every due search", async () => {
    const all = [];
    for (let i = 0; i < 7; i++) all.push(await seed());
    let inFlight = 0;
    let most = 0;
    discover.mockImplementation(async (searchId: string) => {
      most = Math.max(most, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { runId: `run-${searchId}` };
    });
    await tick();
    expect(most).toBe(3);
    expect(ran().sort()).toEqual(all.map((s) => s.searchId).sort());
    expect(sendDigest).toHaveBeenCalledTimes(7);
  });

  it("does not let one slow search hold up the others", async () => {
    const all = [];
    for (let i = 0; i < 5; i++) all.push(await seed());
    let release = () => {};
    const slow = new Promise<void>((r) => (release = r));
    let slowId = "";
    discover.mockImplementation(async (searchId: string) => {
      if (!slowId) {
        slowId = searchId;
        await slow;
      }
      return { runId: `run-${searchId}` };
    });
    const pass = tick();
    // The other four finish and get their email while the first is still going.
    await vi.waitFor(() => expect(sendDigest).toHaveBeenCalledTimes(4));
    expect(sendDigest.mock.calls.map((c) => (c as unknown[])[0])).not.toContain(all.find((s) => s.searchId === slowId)?.userId);
    release();
    await pass;
    expect(sendDigest).toHaveBeenCalledTimes(5);
  });
});

describe("probe: yesterday's late run is not today's run", () => {
  it("runs a Daily search at 7am even though yesterday's scheduled run started late in the evening (#1222)", async () => {
    const s = await seed({ freq: "Daily" });
    // Sunday 2026-11-08 10pm in New York: yesterday's run (the first one, after setup was finished that night).
    await db.insert(schema.runs).values({ userId: s.userId, searchId: s.searchId, trigger: "scheduled", status: "done", startedAt: new Date("2026-11-09T03:00:00Z") });
    vi.setSystemTime(new Date("2026-11-09T12:10:00Z")); // Monday 7:10am in New York
    await tick();
    expect(ran()).toEqual([s.searchId]);
  });
});
