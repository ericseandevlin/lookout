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
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ADMIN_EMAILS = "";
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let me: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));
// Writing the resume calls the model; here only that the go starts it.
const redraftResume = vi.fn<(appId: string) => Promise<void>>(async () => {});
vi.mock("@/lib/application/run", () => ({ redraftResume }));

const { POST } = await import("./route");

type User = typeof schema.users.$inferSelect;
type App = typeof schema.applications.$inferSelect;
let alice: User;

const send = (id: string, data: unknown) =>
  POST(new Request(`https://lookout.test/api/apply/${id}/keywords`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }), {
    params: Promise.resolve({ id }),
  });
const user = async (email: string, isAdmin = true) => (await db.insert(schema.users).values({ email, isAdmin }).returning())[0];
const application = async (u: User, status: App["status"] = "needs_review") => {
  const [o] = await db.insert(schema.opportunities).values({ type: "job", company: "Acme", title: "Designer", fingerprint: crypto.randomUUID() }).returning();
  const report = { postingText: "We want Figma, accessibility and Kubernetes.", keywordPlan: [{ term: "Figma" }, { term: "Accessibility" }, { term: "Kubernetes" }] };
  return (await db.insert(schema.applications).values({ userId: u.id, opportunityId: o.id, status, report }).returning())[0];
};
const report = async (id: string) => (await db.select().from(schema.applications).where(eq(schema.applications.id, id)))[0].report;
const notes = async () => (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, alice.id)))[0].skillNotes;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  redraftResume.mockClear();
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  me = alice;
  await db.insert(schema.profiles).values({ userId: alice.id });
  // Her resume backs Figma and accessibility, not Kubernetes.
  await db
    .insert(schema.materials)
    .values({ userId: alice.id, kind: "resume", extracted: { text: "Led the Figma library for a design system\nShipped accessibility audits across the app" } });
});

describe("POST /api/apply/[id]/keywords gate (#551)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await send(crypto.randomUUID(), { action: "approve" })).status).toBe(401);
  });

  it("is 404 while auto-apply is off, outside the beta, or for someone else's application", async () => {
    const a = await application(alice);
    process.env.FEATURE_AUTO_APPLY = "off";
    expect((await send(a.id, { action: "approve" })).status).toBe(404);
    process.env.FEATURE_AUTO_APPLY = "on";
    me = await user("carol@example.com", false);
    expect((await send(a.id, { action: "approve" })).status).toBe(404);
    me = await user("bob@example.com");
    expect((await send(a.id, { action: "remove", term: "Figma" })).status).toBe(404);
    expect((await send("not-a-uuid", { action: "approve" })).status).toBe(404);
    expect((await report(a.id)).keywordChoices).toBeUndefined();
  });

  // The same lock as edit, revise and approve (#580).
  it.each(["submitting", "submitted", "canceled", "queued", "scanning", "drafting"] as const)("is 409 while the application is %s", async (status) => {
    const a = await application(alice, status);
    expect((await send(a.id, { action: "remove", term: "Figma" })).status).toBe(409);
  });

  it.each([{ action: "nope" }, { action: "remove" }, { action: "add", term: " " }, { action: "experience", term: "Figma" }, { action: "add", term: "x".repeat(81) }])(
    "refuses %j",
    async (data) => {
      const a = await application(alice);
      expect((await send(a.id, data)).status).toBe(400);
    },
  );
});

describe("POST /api/apply/[id]/keywords changes (#551)", () => {
  it("approves exactly the backed terms and starts the redraft", async () => {
    const a = await application(alice);
    const res = await send(a.id, { action: "approve" });
    expect(await res.json()).toEqual({ ok: true });
    expect((await report(a.id)).keywordsApproved?.terms).toEqual(["Figma", "Accessibility"]);
    expect(redraftResume).toHaveBeenCalledWith(a.id);
  });

  it("removes, restores and adds terms, and any change clears the go", async () => {
    const a = await application(alice);
    await send(a.id, { action: "approve" });
    await send(a.id, { action: "remove", term: "Figma" });
    let r = await report(a.id);
    expect(r.keywordChoices).toEqual({ include: [], exclude: ["Figma"] });
    expect(r.keywordsApproved).toBeUndefined();

    await send(a.id, { action: "approve" });
    expect((await report(a.id)).keywordsApproved?.terms).toEqual(["Accessibility"]);

    await send(a.id, { action: "restore", term: "figma" });
    await send(a.id, { action: "add", term: "Prototyping" });
    r = await report(a.id);
    expect(r.keywordChoices).toEqual({ include: ["Prototyping"], exclude: [] });
    expect(r.keywordsApproved).toBeUndefined();
  });

  it("saves what backs a term to the experience notes, so it counts on approve", async () => {
    const a = await application(alice);
    await send(a.id, { action: "experience", term: "Kubernetes", story: "Ran the design tools cluster" });
    await send(a.id, { action: "add", term: "Prototyping", story: "Built clickable prototypes for every launch" });
    expect((await notes()).map((n) => [n.skill, n.story])).toEqual([
      ["Kubernetes", "Ran the design tools cluster"],
      ["Prototyping", "Built clickable prototypes for every launch"],
    ]);
    // An experience note is not a pick: it leaves the choices alone.
    expect((await report(a.id)).keywordChoices).toEqual({ include: ["Prototyping"], exclude: [] });
    await send(a.id, { action: "approve" });
    expect((await report(a.id)).keywordsApproved?.terms).toEqual(["Figma", "Accessibility", "Kubernetes", "Prototyping"]);
  });

  it("refuses the go when no term on the list is backed", async () => {
    const a = await application(alice);
    await send(a.id, { action: "remove", term: "Figma" });
    await send(a.id, { action: "remove", term: "Accessibility" });
    expect((await send(a.id, { action: "approve" })).status).toBe(409);
    expect((await report(a.id)).keywordsApproved).toBeUndefined();
    expect(redraftResume).not.toHaveBeenCalled();
  });
});
