import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Mail } from "@/lib/email";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
// Real email shell and escaping; only the send is caught.
const sendMail = vi.fn<(m: Mail) => Promise<void>>(async () => {});
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail }));

const { sendDigest } = await import("./digest");

const DAY = 24 * 3600_000;
let userId: string;
let searchId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  sendMail.mockReset();
  vi.stubEnv("APP_URL", "https://lookout.example.com");
  vi.stubEnv("APP_SECRET", "s".repeat(32));
  vi.stubEnv("APP_SECRET_PREVIOUS", "");
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "me@example.com", name: "Pat Lee" }).returning();
  [{ id: searchId }] = await db.insert(schema.searches).values({ userId, name: "Job search", answers: {} }).returning();
  await db.insert(schema.settings).values({ userId, digest: true });
});

/** A find on the board, added `ago` ms back. */
async function find(title: string, o: { ago?: number; score?: number; due?: string; pinned?: boolean; archived?: boolean; compMin?: number; compMax?: number; currency?: string } = {}) {
  const [opp] = await db
    .insert(schema.opportunities)
    .values({ company: "Acme <Labs>", title, location: "Remote", fingerprint: title, compMin: o.compMin, compMax: o.compMax, currency: o.currency, attributes: o.due ? { due: o.due } : {} })
    .returning();
  await db.insert(schema.userOpportunities).values({
    userId,
    searchId,
    opportunityId: opp.id,
    score: o.score ?? 4,
    pinned: o.pinned ?? false,
    archived: o.archived ?? false,
    addedAt: new Date(Date.now() - (o.ago ?? 0)),
  });
  return opp.id;
}

/** A date `days` from today as YYYY-MM-DD, today in the app's zone like the digest counts it (#867). */
function inDays(days: number) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.APP_TZ || "America/New_York" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const digests = () => db.select().from(schema.digests).where(eq(schema.digests.userId, userId));
const sent = () => sendMail.mock.calls.map(([m]) => m);

describe("sendDigest", () => {
  it("sends nothing when the finds email is off", async () => {
    await db.update(schema.settings).set({ digest: false }).where(eq(schema.settings.userId, userId));
    await find("Design Director");
    await sendDigest(userId);
    expect(sendMail).not.toHaveBeenCalled();
    expect(await digests()).toHaveLength(0);
  });

  it("sends nothing when nothing is new and nothing is due", async () => {
    await find("Old find", { ago: 3 * DAY });
    await find("Pinned, no date", { ago: 3 * DAY, pinned: true });
    await sendDigest(userId);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("emails the day's new finds, best first, with links through /go", async () => {
    await find("Okay fit", { score: 3 });
    await find("Great fit", { score: 5, compMax: 200000 });
    await find("Last week", { ago: 3 * DAY });
    await sendDigest(userId);

    const [m] = sent();
    expect(m.to).toBe("me@example.com");
    expect(m.subject).toBe("Lookout: 2 new finds");
    expect(m.html).toContain("2 new finds today");
    expect(m.html).not.toContain("this week");
    expect(m.html.indexOf("Great fit")).toBeLessThan(m.html.indexOf("Okay fit"));
    expect(m.text).not.toContain("Last week");
    // Company names are escaped in HTML.
    expect(m.html).toContain("Acme &lt;Labs&gt;");
    expect(m.html).toContain("No comp posted");
    expect(m.headers).toBeDefined();

    const [dg] = await digests();
    expect(dg.finds).toBe(2);
    expect(m.text).toContain(`https://lookout.example.com/go/${dg.id}/board`);
  });

  it("shows a posted floor and a non-USD range instead of No comp posted (#492)", async () => {
    await find("Floor only", { compMin: 150000 });
    await find("London role", { compMin: 60000, compMax: 80000, currency: "GBP" });
    await sendDigest(userId);
    const [m] = sent();
    expect(m.html).toContain("$150,000+");
    expect(m.text).toContain("60,000 – 80,000 GBP");
    expect(m.html).not.toContain("No comp posted");
  });

  it("lists a posting two searches found once, with its best score (#657)", async () => {
    const id = await find("Found twice", { score: 3 });
    const [s2] = await db.insert(schema.searches).values({ userId, name: "Second search", answers: {} }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId: s2.id, opportunityId: id, score: 5 });
    await find("Other find", { score: 4 });
    await sendDigest(userId);
    const [m] = sent();
    expect(m.subject).toBe("Lookout: 2 new finds");
    expect(m.text.match(/Found twice/g)).toHaveLength(1);
    expect(m.text).toContain("5/5  Found twice");
    expect((await digests())[0].finds).toBe(2);
  });

  it("leaves out a posting another search already had before the window (#823)", async () => {
    const id = await find("Already on the board", { ago: 3 * DAY });
    const [s2] = await db.insert(schema.searches).values({ userId, name: "Second search", answers: {} }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId: s2.id, opportunityId: id, score: 5 });
    await find("Really new", { score: 4 });
    await sendDigest(userId);
    const [m] = sent();
    expect(m.subject).toBe("Lookout: 1 new find");
    expect(m.text).not.toContain("Already on the board");
    expect((await digests())[0].finds).toBe(1);
  });

  it("sends nothing when the only new row is a posting already on the board (#823)", async () => {
    const id = await find("Already on the board", { ago: 3 * DAY });
    const [s2] = await db.insert(schema.searches).values({ userId, name: "Second search", answers: {} }).returning();
    await db.insert(schema.userOpportunities).values({ userId, searchId: s2.id, opportunityId: id, score: 5 });
    await sendDigest(userId);
    expect(sent()).toEqual([]);
  });

  it("says one find, not one finds", async () => {
    await find("Only one");
    await sendDigest(userId);
    expect(sent()[0].subject).toBe("Lookout: 1 new find");
  });

  it("adds pinned finds due this week, and lists a new pinned find only once", async () => {
    await find("New and pinned", { pinned: true, due: inDays(2) });
    const dueId = await find("Due tomorrow", { ago: 5 * DAY, pinned: true, due: inDays(1) });
    await find("Due next month", { ago: 5 * DAY, pinned: true, due: inDays(30) });
    await find("Archived", { ago: 5 * DAY, pinned: true, archived: true, due: inDays(1) });
    await sendDigest(userId);

    const [m] = sent();
    expect(m.subject).toBe("Lookout: 1 new find, 1 due soon");
    expect(m.html).toContain("DUE TOMORROW");
    expect(m.html.split("New and pinned")).toHaveLength(2);
    expect(m.text).not.toContain("Due next month");
    expect(m.text).not.toContain("Archived");
    const [dg] = await digests();
    expect(m.text).toContain(`/go/${dg.id}/${dueId}`);
  });

  it("sends a due-soon-only email at most once a day", async () => {
    await find("Due today", { ago: 5 * DAY, pinned: true, due: inDays(0) });
    await sendDigest(userId);
    expect(sent()[0].subject).toBe("Lookout: 1 pinned find due soon");
    expect(sent()[0].text).toContain("Due today: Due today, Acme <Labs>");

    await sendDigest(userId);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await digests()).toHaveLength(1);
  });

  it("still sends new finds the same day as a due-soon email", async () => {
    await find("Due today", { ago: 5 * DAY, pinned: true, due: inDays(0) });
    await sendDigest(userId);
    // A clear second later: the email's time is the database clock, the find's is this process's clock.
    await find("Fresh", { ago: -1000 });
    await sendDigest(userId);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("lists only finds added since the last finds email, even when it was under a day ago (#586)", async () => {
    await find("Already emailed", { ago: 21 * 3600_000 });
    await db.insert(schema.digests).values({ userId, finds: 1, sentAt: new Date(Date.now() - 20 * 3600_000) });
    await find("Since then", { ago: 3600_000 });
    await sendDigest(userId);
    const [m] = sent();
    expect(m.subject).toBe("Lookout: 1 new find");
    expect(m.text).toContain("Since then");
    expect(m.text).not.toContain("Already emailed");
  });

  it("sends nothing when every find since the last email is already covered (#586)", async () => {
    await find("Already emailed", { ago: 2 * 3600_000 });
    await db.insert(schema.digests).values({ userId, finds: 1, sentAt: new Date(Date.now() - 3600_000) });
    await sendDigest(userId);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("leaves out finds archived since they were added (#586)", async () => {
    await find("Archived", { archived: true });
    await find("Kept");
    await sendDigest(userId);
    const [m] = sent();
    expect(m.subject).toBe("Lookout: 1 new find");
    expect(m.text).not.toContain("Archived");
  });

  it("drops the digest record when the send fails", async () => {
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    await find("Design Director");
    await expect(sendDigest(userId)).rejects.toThrow("SMTP down");
    expect(await digests()).toHaveLength(0);
  });
});
