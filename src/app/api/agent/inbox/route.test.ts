import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
const TOKEN = "t".repeat(40);
vi.hoisted(() => {
  process.env.AGENT_TOKEN = "t".repeat(40);
});
let auth = `Bearer ${TOKEN}`;
vi.mock("next/headers", () => ({ headers: async () => new Headers({ authorization: auth }) }));

const list = (await import("./route")).GET;
const triage = (await import("./[id]/route")).POST;
const progress = (await import("../runs/[id]/progress/route")).POST;

const get = (q = "") => list(new Request(`https://lookout.test/api/agent/inbox${q}`), {});
const post = (fn: typeof triage, url: string, id: string, data: unknown) =>
  fn(new Request(`https://lookout.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof data === "string" ? data : JSON.stringify(data) }), {
    params: Promise.resolve({ id }),
  });
const email = async (over: Partial<typeof schema.inboundEmails.$inferInsert> = {}) =>
  (await db.insert(schema.inboundEmails).values({ resendId: crypto.randomUUID(), fromAddr: "r@example.com", subject: "Hi", receivedAt: new Date(), ...over }).returning())[0];
const read = { kind: "recruiter", summary: "A recruiter asking for a call", by: "quill" };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  auth = `Bearer ${TOKEN}`;
  await db.delete(schema.inboundEmails);
  await db.delete(schema.users);
});

describe("GET /api/agent/inbox (#178)", () => {
  it("refuses a missing or wrong token", async () => {
    auth = "";
    expect((await get()).status).toBe(401);
    auth = `Bearer ${TOKEN.slice(1)}x`;
    expect((await get()).status).toBe(401);
  });

  it("lists new mail by default, newest first, and filters by status", async () => {
    await email({ subject: "Old", receivedAt: new Date("2026-11-01") });
    await email({ subject: "New", receivedAt: new Date("2026-11-07") });
    await email({ subject: "Done", status: "triaged" });
    expect((await (await get()).json()).emails.map((e: { subject: string }) => e.subject)).toEqual(["New", "Old"]);
    expect((await (await get("?status=triaged")).json()).emails).toHaveLength(1);
    expect((await (await get("?status=all")).json()).emails).toHaveLength(3);
    // Unknown status falls back to new; limit caps the count.
    expect((await (await get("?status=bogus&limit=1")).json()).emails).toHaveLength(1);
  });
});

describe("POST /api/agent/inbox/[id] (#178)", () => {
  const url = (id: string) => `/api/agent/inbox/${id}`;

  it("saves the agent's read and marks the email triaged", async () => {
    const e = await email();
    expect((await post(triage, url(e.id), e.id, read)).status).toBe(200);
    const [after] = await db.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.id, e.id));
    expect(after.status).toBe("triaged");
    expect(after.triage).toMatchObject({ kind: "recruiter", by: "quill" });
    expect(after.triagedAt).toBeInstanceOf(Date);
  });

  it("can mark an email ignored", async () => {
    const e = await email();
    await post(triage, url(e.id), e.id, { ...read, kind: "spam", status: "ignored" });
    expect((await db.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.id, e.id)))[0].status).toBe("ignored");
  });

  it("404s an unknown or malformed id", async () => {
    const id = crypto.randomUUID();
    expect((await post(triage, url(id), id, read)).status).toBe(404);
    expect((await post(triage, url("nope"), "nope", read)).status).toBe(404);
  });

  it("400s a body that isn't JSON or has bad fields (#400)", async () => {
    const e = await email();
    expect((await post(triage, url(e.id), e.id, "not json")).status).toBe(400);
    expect((await post(triage, url(e.id), e.id, { ...read, kind: "friend" })).status).toBe(400);
    expect((await db.select().from(schema.inboundEmails).where(eq(schema.inboundEmails.id, e.id)))[0].status).toBe("new");
  });
});

describe("POST /api/agent/runs/[id]/progress", () => {
  const url = (id: string) => `/api/agent/runs/${id}/progress`;
  const run = async (status: "queued" | "running" | "done") => {
    const [u] = await db.insert(schema.users).values({ email: "a@example.com" }).returning();
    return (await db.insert(schema.runs).values({ userId: u.id, trigger: "manual", status }).returning())[0];
  };
  const reload = async (id: string) => (await db.select().from(schema.runs).where(eq(schema.runs.id, id)))[0];

  it("updates a running job, and never reports 100 before it completes", async () => {
    const r = await run("running");
    expect((await post(progress, url(r.id), r.id, { pct: 40, step: "Reading postings" })).status).toBe(200);
    expect((await reload(r.id)).progress).toMatchObject({ pct: 40, step: "Reading postings" });
    await post(progress, url(r.id), r.id, { pct: 100, step: "Almost" });
    expect((await reload(r.id)).progress.pct).toBe(99);
  });

  it("409s a job that isn't running", async () => {
    const r = await run("done");
    expect((await post(progress, url(r.id), r.id, { pct: 10, step: "x" })).status).toBe(409);
  });

  it("400s bad input", async () => {
    const r = await run("running");
    expect((await post(progress, url(r.id), r.id, { pct: 150, step: "x" })).status).toBe(400);
    expect((await post(progress, url(r.id), r.id, { pct: 10, step: "" })).status).toBe(400);
  });
});
