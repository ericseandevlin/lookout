import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let current: typeof schema.users.$inferSelect | null = null;
let beta = true;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => current, refreshSession: async () => {} }));
vi.mock("@/lib/apply", async (orig) => ({ ...(await orig<typeof import("@/lib/apply")>()), canUseAutoApply: () => beta }));
// The browser worker has its own tests; here only whether the route starts it, and where screenshots are read from.
const worker = vi.hoisted(() => ({ autoSubmit: true, dir: "", startFill: vi.fn(async () => {}) }));
vi.mock("@/lib/application/submit", () => ({
  canAutoSubmit: () => worker.autoSubmit,
  startFill: worker.startFill,
  shotDir: (appId: string) => path.join(worker.dir, appId),
}));

const { POST: fill } = await import("./route");
const { GET: screenshot } = await import("../screenshot/route");

type App = typeof schema.applications.$inferSelect;
const start = (id: string, data: unknown) =>
  fill(new Request(`https://lookout.test/api/apply/${id}/fill`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {
    params: Promise.resolve({ id }),
  });
const shot = (id: string, which?: string) =>
  screenshot(new Request(`https://lookout.test/api/apply/${id}/screenshot${which ? `?which=${which}` : ""}`), { params: Promise.resolve({ id }) });

let other: typeof schema.users.$inferSelect;
let findId = "";
const application = async (userId: string, status: App["status"], route: App["route"] = "browser") =>
  (await db.insert(schema.applications).values({ userId, opportunityId: findId, status, route }).returning())[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
  worker.dir = await mkdtemp(path.join(os.tmpdir(), "lookout-shots-"));
});
afterAll(async () => {
  await pg.close();
  await rm(worker.dir, { recursive: true, force: true });
});
beforeEach(async () => {
  beta = true;
  worker.autoSubmit = true;
  worker.startFill.mockClear();
  await db.delete(schema.users);
  await db.delete(schema.opportunities);
  [current, other] = await db.insert(schema.users).values([{ email: "maya@example.com" }, { email: "other@example.com" }]).returning();
  [{ id: findId }] = await db.insert(schema.opportunities).values({ company: "Venue", title: "Director of Events", fingerprint: crypto.randomUUID() }).returning();
});

describe("POST /api/apply/[id]/fill (#574)", () => {
  it.each(["test", "submit"] as const)("starts a %s fill of an approved browser application", async (mode) => {
    const a = await application(current!.id, "approved");
    const res = await start(a.id, { mode });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(worker.startFill).toHaveBeenCalledWith(a.id, mode);
  });

  it("refuses a mode it doesn't know", async () => {
    const a = await application(current!.id, "approved");
    expect((await start(a.id, { mode: "send" })).status).toBe(400);
    expect((await start(a.id, {})).status).toBe(400);
    expect(worker.startFill).not.toHaveBeenCalled();
  });

  it("sends a site that needs the manual checklist back to it", async () => {
    const a = await application(current!.id, "approved", "manual");
    const res = await start(a.id, { mode: "test" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/manual checklist/);
    expect(worker.startFill).not.toHaveBeenCalled();
  });

  it("is 409 until it's approved, and says so while it's already sending", async () => {
    for (const status of ["needs_review", "failed", "submitted"] as const) {
      await db.delete(schema.applications);
      const a = await application(current!.id, status);
      const res = await start(a.id, { mode: "submit" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Approve every required item/);
    }
    await db.delete(schema.applications);
    const sending = await application(current!.id, "submitting");
    const res = await start(sending.id, { mode: "submit" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already sending/);
    expect(worker.startFill).not.toHaveBeenCalled();
  });

  it("answers 404 for someone else's application, an unknown one, or a bad id", async () => {
    const theirs = await application(other.id, "approved");
    expect((await start(theirs.id, { mode: "submit" })).status).toBe(404);
    expect((await start("00000000-0000-4000-8000-000000000000", { mode: "test" })).status).toBe(404);
    expect((await start("not-a-uuid", { mode: "test" })).status).toBe(404);
    expect(worker.startFill).not.toHaveBeenCalled();
  });

  it("is hidden while auto-submit is off or outside the beta, and needs a session", async () => {
    const a = await application(current!.id, "approved");
    worker.autoSubmit = false;
    expect((await start(a.id, { mode: "submit" })).status).toBe(404);
    worker.autoSubmit = true;
    beta = false;
    expect((await start(a.id, { mode: "submit" })).status).toBe(404);
    beta = true;
    current = null;
    expect((await start(a.id, { mode: "submit" })).status).toBe(401);
    expect(worker.startFill).not.toHaveBeenCalled();
  });
});

describe("GET /api/apply/[id]/screenshot (#574)", () => {
  const save = async (appId: string, which: string, bytes: string) => {
    await mkdir(path.join(worker.dir, appId), { recursive: true });
    await writeFile(path.join(worker.dir, appId, `${which}.png`), bytes);
  };

  it("serves the filled form by default and the page after Submit when asked, never cached", async () => {
    const a = await application(current!.id, "submitted");
    await save(a.id, "filled", "filled-png");
    await save(a.id, "after-submit", "after-png");
    const filled = await shot(a.id);
    expect(filled.status).toBe(200);
    expect(filled.headers.get("content-type")).toBe("image/png");
    expect(filled.headers.get("cache-control")).toBe("no-store");
    expect(await filled.text()).toBe("filled-png");
    expect(await (await shot(a.id, "after-submit")).text()).toBe("after-png");
  });

  it("reads only those two files, whatever else is asked for", async () => {
    const a = await application(current!.id, "approved");
    await save(a.id, "filled", "filled-png");
    expect(await (await shot(a.id, "../../etc/passwd")).text()).toBe("filled-png");
  });

  it("is 404 before the worker has taken one", async () => {
    const a = await application(current!.id, "approved");
    expect((await shot(a.id)).status).toBe(404);
    await save(a.id, "filled", "filled-png");
    expect((await shot(a.id, "after-submit")).status).toBe(404);
  });

  it("won't show someone else's, and needs the beta and a session", async () => {
    const theirs = await application(other.id, "approved");
    await save(theirs.id, "filled", "theirs");
    expect((await shot(theirs.id)).status).toBe(404);
    expect((await shot("not-a-uuid")).status).toBe(404);
    const mine = await application(current!.id, "approved");
    await save(mine.id, "filled", "mine");
    beta = false;
    expect((await shot(mine.id)).status).toBe(404);
    beta = true;
    current = null;
    expect((await shot(mine.id)).status).toBe(401);
  });
});
