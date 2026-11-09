import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { WAITLIST_NOTICE_VERSION } from "@/lib/legal";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
});
let ip = "10.0.0.1";
let origin = "https://lookout.test";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin, "x-forwarded-for": ip }) }));

const { POST } = await import("./route");

const post = (data: unknown) =>
  POST(new Request("https://lookout.test/api/auth/request-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {});
const rows = () => db.select().from(schema.accessRequests);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  ip = "10.0.0.1";
  origin = "https://lookout.test";
  await db.delete(schema.accessRequests);
  await db.delete(schema.rateLimits);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/auth/request-access (#454)", () => {
  it("adds a pending request with the consent record, under the normalized email", async () => {
    const before = Date.now();
    const res = await post({ email: "  Maya@Example.com ", nextMove: "step_up" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await rows();
    expect(row).toMatchObject({ email: "maya@example.com", status: "pending", kind: "job", nextMove: "step_up", consentVersion: WAITLIST_NOTICE_VERSION });
    expect(row.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("refreshes the answers on a repeat but never reopens a decision", async () => {
    await db.insert(schema.accessRequests).values({ email: "maya@example.com", status: "declined", decidedAt: new Date("2026-11-01") });
    const res = await post({ email: "maya@example.com", nextMove: "switch" });
    expect(await res.json()).toEqual({ ok: true });
    const [row] = await rows();
    expect(row).toMatchObject({ status: "declined", nextMove: "switch", consentVersion: WAITLIST_NOTICE_VERSION });
    expect(row.decidedAt).toEqual(new Date("2026-11-01"));
  });

  it("records the channel they came from as a slug, and keeps the first one on a repeat (#527)", async () => {
    await post({ email: "maya@example.com", channel: "Reddit Ads" });
    await post({ email: "maya@example.com", channel: "hn" });
    await post({ email: "lee@example.com" });
    const byEmail = Object.fromEntries((await rows()).map((r) => [r.email, r.channel]));
    expect(byEmail).toEqual({ "maya@example.com": "reddit-ads", "lee@example.com": null });
  });

  it("fills in a channel on a repeat when the first request had none (#527)", async () => {
    await post({ email: "maya@example.com" });
    await post({ email: "maya@example.com", channel: "hn" });
    expect((await rows())[0].channel).toBe("hn");
  });

  it("gives an approved address the same answer as a new one", async () => {
    await db.insert(schema.accessRequests).values({ email: "maya@example.com", status: "approved" });
    const res = await post({ email: "maya@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await rows())[0].status).toBe("approved");
  });

  it("keeps the kind to job unless several searches are switched on", async () => {
    await post({ email: "a@example.com", kind: "rfp" });
    vi.stubEnv("FEATURE_SEARCHES", "on");
    await post({ email: "b@example.com", kind: "rfp" });
    const byEmail = Object.fromEntries((await rows()).map((r) => [r.email, r.kind]));
    expect(byEmail).toEqual({ "a@example.com": "job", "b@example.com": "rfp" });
  });

  it("refuses a bad email, an unknown kind or an unknown next move, and stores nothing", async () => {
    expect((await post({ email: "not an email" })).status).toBe(400);
    expect((await post({ email: "a@example.com", kind: "pets" })).status).toBe(400);
    expect((await post({ email: "a@example.com", nextMove: "retire" })).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("allows 5 requests an hour per IP", async () => {
    for (let i = 0; i < 5; i++) expect((await post({ email: `p${i}@example.com` })).status).toBe(200);
    const res = await post({ email: "p5@example.com" });
    expect(res.status).toBe(429);
    expect(await rows()).toHaveLength(5);
    ip = "10.0.0.2";
    expect((await post({ email: "p5@example.com" })).status).toBe(200);
  });

  it("refuses a request from another origin", async () => {
    origin = "https://evil.test";
    expect((await post({ email: "a@example.com" })).status).toBe(403);
    expect(await rows()).toEqual([]);
  });

  describe("with Turnstile configured", () => {
    beforeEach(() => {
      vi.stubEnv("TURNSTILE_SITE_KEY", "site");
      vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    });

    it("lets a request in when Cloudflare passes the token, and sends it the token and IP", async () => {
      const fetchMock = vi.fn(async () => Response.json({ success: true }));
      vi.stubGlobal("fetch", fetchMock);
      expect((await post({ email: "a@example.com", turnstileToken: "tok" })).status).toBe(200);
      const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
      expect(Object.fromEntries(form)).toEqual({ secret: "secret", response: "tok", remoteip: "10.0.0.1" });
      expect(await rows()).toHaveLength(1);
    });

    it("fails closed: no token, a failed check or Cloudflare down all refuse and store nothing", async () => {
      const fetchMock = vi.fn(async () => Response.json({ success: false }));
      vi.stubGlobal("fetch", fetchMock);
      expect((await post({ email: "a@example.com" })).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await post({ email: "a@example.com", turnstileToken: "bad" })).status).toBe(400);
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
      expect((await post({ email: "a@example.com", turnstileToken: "tok" })).status).toBe(400);
      expect(await rows()).toEqual([]);
    });
  });
});
