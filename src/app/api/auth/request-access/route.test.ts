import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { WAITLIST_NOTICE_VERSION, WAITLIST_OPTIN_NOTICE_VERSION } from "@/lib/legal";
import { readConfirmToken } from "@/lib/waitlist";

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
const sendMail = vi.hoisted(() => vi.fn<(mail: { to: string; subject: string; text: string }) => Promise<void>>(async () => {}));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail }));

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
  sendMail.mockClear();
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

  it("counts someone's personal link as a referral and records who sent them (#527)", async () => {
    const [paul] = await db.insert(schema.users).values({ email: "paul@example.com", referralCode: "abc123" }).returning();
    await post({ email: "maya@example.com", channel: "r-abc123" });
    await post({ email: "lee@example.com", channel: "r-unknown" });
    // A later referral link doesn't take over a request that already has a channel.
    await post({ email: "sam@example.com", channel: "hn" });
    await post({ email: "sam@example.com", channel: "r-abc123" });
    const byEmail = Object.fromEntries((await rows()).map((r) => [r.email, [r.channel, r.referredBy]]));
    expect(byEmail).toEqual({ "maya@example.com": ["referral", paul.id], "lee@example.com": ["r-unknown", null], "sam@example.com": ["hn", null] });
    await db.delete(schema.users);
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

  it("sends no email and ignores the free-text answer while the waitlist switch is off (#9)", async () => {
    expect(await (await post({ email: "maya@example.com", searchFor: "Design lead roles" })).json()).toEqual({ ok: true });
    expect(sendMail).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ searchFor: null, confirmedAt: null, consentVersion: WAITLIST_NOTICE_VERSION });
  });

  describe("with FEATURE_WAITLIST on (#9)", () => {
    beforeEach(() => {
      vi.stubEnv("FEATURE_WAITLIST", "on");
      vi.stubEnv("APP_SECRET", "x".repeat(32));
    });

    it("stores what they'd search for, records the opt-in notice and sends one confirm link", async () => {
      const res = await post({ email: "Maya@Example.com", searchFor: "  Design lead roles in Chicago  " });
      expect(await res.json()).toEqual({ ok: true, confirm: true });
      expect((await rows())[0]).toMatchObject({ email: "maya@example.com", searchFor: "Design lead roles in Chicago", consentVersion: WAITLIST_OPTIN_NOTICE_VERSION, confirmedAt: null });
      expect(sendMail).toHaveBeenCalledTimes(1);
      const mail = sendMail.mock.calls[0][0];
      expect(mail.to).toBe("maya@example.com");
      const t = mail.text.match(/\/waitlist\/confirm\?t=([^\s]+)/)![1];
      expect(readConfirmToken(t, ["x".repeat(32)])).toBe("maya@example.com");
    });

    it("sends nothing to someone already confirmed, approved or declined, with the same answer", async () => {
      await db.insert(schema.accessRequests).values([
        { email: "c@example.com", confirmedAt: new Date() },
        { email: "a@example.com", status: "approved" },
        { email: "d@example.com", status: "declined" },
      ]);
      for (const email of ["c@example.com", "a@example.com", "d@example.com"]) expect(await (await post({ email })).json()).toEqual({ ok: true, confirm: true });
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("sends at most 3 confirm emails a day to one address", async () => {
      for (let i = 0; i < 5; i++) {
        ip = `10.0.1.${i}`;
        expect((await post({ email: "maya@example.com" })).status).toBe(200);
      }
      expect(sendMail).toHaveBeenCalledTimes(3);
    });

    it("refuses a free-text answer over 500 characters", async () => {
      expect((await post({ email: "maya@example.com", searchFor: "x".repeat(501) })).status).toBe(400);
      expect(await rows()).toEqual([]);
    });
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
