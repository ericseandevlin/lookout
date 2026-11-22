// A repost brought back by a search (#922) reaches the finds email, end to end through save() and sendDigest (#1363).
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Mail } from "@/lib/email";

const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
const sendMail = vi.fn<(m: Mail) => Promise<void>>(async () => {});
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail }));
const { save } = await import("./discover");
const { sendDigest } = await import("@/lib/digest");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  vi.stubEnv("APP_URL", "https://lookout.example.com");
  vi.stubEnv("APP_SECRET", "s".repeat(32));
  vi.stubEnv("APP_SECRET_PREVIOUS", "");
});
afterAll(async () => {
  await pg.close();
});

it("a repost that save() brings back as a new find is in that day's finds email (#1363)", async () => {
  const [u] = await db.insert(schema.users).values({ email: "me@example.com" }).returning();
  const [s] = await db.insert(schema.searches).values({ userId: u.id, name: "Job search", answers: {} }).returning();
  await db.insert(schema.settings).values({ userId: u.id, digest: true });
  const base = {
    index: 0, is_open_job_posting: true, company: "Acme", title: "Director of Design", location: "New York, NY", work_mode: "Hybrid" as const,
    comp_min: 200000, comp_max: 250000, posted_at: "2026-11-01", description: "Lead.", score: 5, reasons_match: [], reasons_gap: [], location_fit: true, dealbreaker: false,
  };
  const ctx = { searchId: s.id, kind: "job", userId: u.id, brief: "", resume: "", linkedin: "", links: [], searchProfile: null, rejected: [], floor: null, knownUrls: [], answers: {}, hasResume: false };
  // Found two weeks ago, then closed by the link check before they applied.
  await save(ctx, [{ ...base, url: "https://jobs.example.com/acme/123" }], "agent");
  await db.update(schema.userOpportunities).set({ addedAt: new Date(Date.now() - 14 * 864e5), stage: "Closed", archived: true, closedFrom: "Not applied" });
  await db.update(schema.opportunities).set({ attributes: { linkCheck: { checkedAt: "2026-11-01T00:00:00.000Z", state: "gone", reason: "404", goneSince: "2026-10-30T00:00:00.000Z" } } });
  // Today's run finds the repost: the run reports it added.
  const r = await save({ ...ctx, knownUrls: ["https://jobs.example.com/acme/123"] }, [{ ...base, url: "https://jobs.example.com/acme/456" }], "agent");
  expect(r.added).toBe(1);
  await sendDigest(u.id);
  expect(sendMail).toHaveBeenCalledOnce();
  expect(sendMail.mock.calls[0][0].subject).toBe("Lookout: 1 new find");
});
