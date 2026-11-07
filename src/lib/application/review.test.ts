import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { ApplicationStatus } from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.mock("@/lib/ai/runs", () => ({ assertBudget: async () => {} }));
// The model is never called for real; each test says what it "returns".
const completeJSON = vi.fn();
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON: (...a: unknown[]) => completeJSON(...a) }));

const { approveItem, editItem, markSubmitted, ownApplication, reviseItem, sentRecord } = await import("./review");

let userId: string;
let otherId: string;
let oppId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  completeJSON.mockReset();
  vi.stubEnv("FEATURE_AUTO_SUBMIT", "");
  await db.delete(schema.applications);
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  [{ id: userId }, { id: otherId }] = await db.insert(schema.users).values([{ email: "me@example.com" }, { email: "other@example.com" }]).returning();
  await db.insert(schema.profiles).values({ userId });
  const [search] = await db.insert(schema.searches).values({ userId, name: "Job search", answers: {} }).returning();
  [{ id: oppId }] = await db.insert(schema.opportunities).values({ company: "Acme", title: "Design Director", fingerprint: "acme-dd" }).returning();
  await db.insert(schema.userOpportunities).values({ userId, searchId: search.id, opportunityId: oppId, score: 4 });
});

type ItemSeed = { kind: schema.ApplicationItemKind; prompt: string; required?: boolean; options?: string[]; content?: string; approved?: boolean };

/** One application with items, each with a first AI version (approved when asked). */
async function seed(status: ApplicationStatus, items: ItemSeed[], route: "api" | "browser" | "manual" = "manual") {
  const [a] = await db.insert(schema.applications).values({ userId, opportunityId: oppId, status, route, report: { applyUrl: "https://jobs.example.com/apply" } }).returning();
  const ids: { item: string; version: string }[] = [];
  for (const [position, s] of items.entries()) {
    const [it] = await db.insert(schema.applicationItems).values({ applicationId: a.id, kind: s.kind, prompt: s.prompt, required: s.required ?? true, options: s.options, position }).returning();
    const [v] = await db.insert(schema.itemVersions).values({ itemId: it.id, version: 1, content: s.content ?? `Draft for ${s.prompt}`, author: "ai" }).returning();
    if (s.approved) await db.update(schema.applicationItems).set({ approvedVersionId: v.id }).where(eq(schema.applicationItems.id, it.id));
    ids.push({ item: it.id, version: v.id });
  }
  return { appId: a.id, ids };
}

const item = async (id: string) => (await db.select().from(schema.applicationItems).where(eq(schema.applicationItems.id, id)))[0];
const app = async (id: string) => (await db.select().from(schema.applications).where(eq(schema.applications.id, id)))[0];
const versions = async (itemId: string) => db.select().from(schema.itemVersions).where(eq(schema.itemVersions.itemId, itemId)).orderBy(schema.itemVersions.version);

describe("ownApplication", () => {
  it("is a 404 for a malformed id or someone else's application", async () => {
    const { appId } = await seed("needs_review", [{ kind: "answer", prompt: "Why us?" }]);
    expect((await ownApplication(userId, appId)).id).toBe(appId);
    await expect(ownApplication(userId, "not-a-uuid")).rejects.toMatchObject({ status: 404 });
    await expect(ownApplication(otherId, appId)).rejects.toMatchObject({ status: 404 });
  });
});

describe("editItem", () => {
  it("adds a new version by the user and clears the approval", async () => {
    const { appId, ids } = await seed("manual", [{ kind: "answer", prompt: "Why us?", approved: true }]);
    expect(await editItem(userId, appId, ids[0].item, "My own words.", "")).toBe("needs_review");
    const vs = await versions(ids[0].item);
    expect(vs.map((v) => [v.version, v.author, v.content])).toEqual([
      [1, "ai", "Draft for Why us?"],
      [2, "user", "My own words."],
    ]);
    expect(vs[1].note).toBe("Edited by you.");
    expect((await item(ids[0].item)).approvedVersionId).toBeNull();
    expect((await app(appId)).status).toBe("needs_review");
  });

  it("keeps a basic field approved and remembers common answers on the profile", async () => {
    const { appId, ids } = await seed("needs_review", [{ kind: "field", prompt: "ZIP code" }]);
    expect(await editItem(userId, appId, ids[0].item, "10001", "")).toBe("manual");
    const it = await item(ids[0].item);
    expect(it.approvedVersionId).toBe((await versions(ids[0].item))[1].id);
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    expect(p.applyAnswers.map((s) => [s.question, s.answer])).toEqual([["ZIP code", "10001"]]);
  });

  it("refuses an answer that isn't one of the options", async () => {
    const { appId, ids } = await seed("needs_review", [{ kind: "answer", prompt: "Are you 18?", options: ["Yes", "No"] }]);
    await expect(editItem(userId, appId, ids[0].item, "Maybe", "")).rejects.toMatchObject({ status: 400 });
    expect(await versions(ids[0].item)).toHaveLength(1);
  });

  it("is a 404 for an item from another application", async () => {
    const { appId } = await seed("needs_review", [{ kind: "answer", prompt: "Why us?" }]);
    const [o2] = await db.insert(schema.opportunities).values({ company: "Beta", title: "Lead", fingerprint: "beta" }).returning();
    const [a2] = await db.insert(schema.applications).values({ userId, opportunityId: o2.id, status: "needs_review" }).returning();
    const [it2] = await db.insert(schema.applicationItems).values({ applicationId: a2.id, kind: "answer", prompt: "Other" }).returning();
    await expect(editItem(userId, appId, it2.id, "x", "")).rejects.toMatchObject({ status: 404 });
  });

  it("needs EEO consent, and never stores the answer as a version", async () => {
    vi.stubEnv("APP_SECRET", "a".repeat(32));
    const { appId, ids } = await seed("needs_review", [{ kind: "eeo", prompt: "Veteran status", required: false, options: ["Yes", "No", "Decline"] }]);
    await expect(editItem(userId, appId, ids[0].item, "Decline", "")).rejects.toMatchObject({ status: 409 });
    await db.update(schema.profiles).set({ eeoConsent: true }).where(eq(schema.profiles.userId, userId));
    await editItem(userId, appId, ids[0].item, "Decline", "");
    expect(await versions(ids[0].item)).toHaveLength(1);
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    expect(p.eeo).toBeTruthy();
    expect(p.eeo).not.toContain("Decline");
  });
});

describe("approveItem", () => {
  it("settles to manual once every required item is approved, ignoring optional ones", async () => {
    const { appId, ids } = await seed("needs_review", [
      { kind: "resume", prompt: "Resume" },
      { kind: "cover_letter", prompt: "Cover letter" },
      { kind: "answer", prompt: "Anything else?", required: false },
    ]);
    expect(await approveItem(userId, appId, ids[0].item, ids[0].version)).toBe("needs_review");
    expect(await approveItem(userId, appId, ids[1].item, ids[1].version)).toBe("manual");
    expect((await app(appId)).status).toBe("manual");
  });

  it("settles to approved on the browser route only when Submit for me is on", async () => {
    const { appId, ids } = await seed("needs_review", [{ kind: "resume", prompt: "Resume" }], "browser");
    expect(await approveItem(userId, appId, ids[0].item, ids[0].version)).toBe("manual");
    vi.stubEnv("FEATURE_AUTO_SUBMIT", "on");
    expect(await approveItem(userId, appId, ids[0].item, ids[0].version)).toBe("approved");
  });

  it("refuses an empty version and a version from another item", async () => {
    const { appId, ids } = await seed("needs_review", [
      { kind: "answer", prompt: "Why us?", content: "  " },
      { kind: "answer", prompt: "Why now?" },
    ]);
    await expect(approveItem(userId, appId, ids[0].item, ids[0].version)).rejects.toMatchObject({ status: 400 });
    await expect(approveItem(userId, appId, ids[0].item, ids[1].version)).rejects.toMatchObject({ status: 404 });
    expect((await item(ids[0].item)).approvedVersionId).toBeNull();
  });

  it("un-approving moves a ready application back to needs review", async () => {
    const { appId, ids } = await seed("manual", [{ kind: "resume", prompt: "Resume", approved: true }]);
    expect(await approveItem(userId, appId, ids[0].item, null)).toBe("needs_review");
  });
});

describe("locked and drafting applications", () => {
  it.each(["submitting", "submitted", "canceled"] as const)("a %s application can't be edited, approved or revised", async (status) => {
    const { appId, ids } = await seed(status, [{ kind: "answer", prompt: "Why us?" }]);
    await expect(editItem(userId, appId, ids[0].item, "x", "")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/already sent/) });
    await expect(approveItem(userId, appId, ids[0].item, ids[0].version)).rejects.toMatchObject({ status: 409 });
    await expect(reviseItem(userId, appId, ids[0].item, "shorter")).rejects.toMatchObject({ status: 409 });
    expect(await versions(ids[0].item)).toHaveLength(1);
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it.each(["queued", "scanning", "drafting"] as const)("a %s application isn't ready to edit yet", async (status) => {
    const { appId, ids } = await seed(status, [{ kind: "answer", prompt: "Why us?" }]);
    await expect(editItem(userId, appId, ids[0].item, "x", "")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/still drafting/) });
  });
});

describe("reviseItem", () => {
  it("never sends an EEO question to the model", async () => {
    const { appId, ids } = await seed("needs_review", [{ kind: "eeo", prompt: "Gender", required: false }]);
    await expect(reviseItem(userId, appId, ids[0].item, "pick one")).rejects.toMatchObject({ status: 400 });
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("adds the AI's version, clears the approval and keeps the thread", async () => {
    completeJSON.mockResolvedValue({ content: "Shorter — and plainer.", note: "Cut it to one line.", question: "" });
    const { appId, ids } = await seed("manual", [{ kind: "answer", prompt: "Why us?", approved: true }]);
    expect(await reviseItem(userId, appId, ids[0].item, "make it shorter")).toEqual({ status: "needs_review", question: null });
    const vs = await versions(ids[0].item);
    expect(vs[1]).toMatchObject({ version: 2, author: "ai", content: "Shorter, and plainer." });
    expect(vs[1].note).toContain("Cut it to one line.");
    expect((await item(ids[0].item)).approvedVersionId).toBeNull();
    const msgs = await db.select().from(schema.applicationMessages).where(eq(schema.applicationMessages.applicationId, appId));
    expect(msgs.map((m) => m.role).sort()).toEqual(["assistant", "user"]);
  });

  it("asks instead of adding a version when the model needs a fact", async () => {
    completeJSON.mockResolvedValue({ content: "", note: "", question: "Which year did you start?" });
    const { appId, ids } = await seed("needs_review", [{ kind: "answer", prompt: "Why us?" }]);
    expect(await reviseItem(userId, appId, ids[0].item, "add my start year")).toEqual({ status: "needs_review", question: "Which year did you start?" });
    expect(await versions(ids[0].item)).toHaveLength(1);
  });
});

describe("sentRecord and markSubmitted", () => {
  it("refuses until every required item is approved", async () => {
    const { appId } = await seed("needs_review", [{ kind: "resume", prompt: "Resume" }]);
    await expect(markSubmitted(userId, appId)).rejects.toMatchObject({ status: 409 });
    expect((await app(appId)).status).toBe("needs_review");
  });

  it("records exactly the approved versions, leaves out outreach, and moves the find to Applied", async () => {
    const { appId, ids } = await seed("manual", [
      { kind: "resume", prompt: "Resume", approved: true },
      { kind: "answer", prompt: "Anything else?", required: false },
      { kind: "outreach", prompt: "Note to the hiring manager", required: false, approved: true },
    ]);
    await db.insert(schema.itemVersions).values({ itemId: ids[0].item, version: 2, content: "Unapproved rewrite", author: "user" });
    expect(await sentRecord(appId)).toEqual([{ prompt: "Resume", kind: "resume", version: 1, content: "Draft for Resume" }]);

    expect(await markSubmitted(userId, appId)).toBe("submitted");
    const a = await app(appId);
    expect(a.status).toBe("submitted");
    expect(a.submittedAt).not.toBeNull();
    expect(a.confirmation).toMatchObject({ how: "manual", applyUrl: "https://jobs.example.com/apply", sent: [{ prompt: "Resume", version: 1 }] });
    const [uo] = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, oppId));
    expect(uo.stage).toBe("Applied");
  });

  it("records the extension's confirmation, and a second call changes nothing", async () => {
    const { appId } = await seed("approved", [{ kind: "resume", prompt: "Resume", approved: true }], "browser");
    await markSubmitted(userId, appId, { how: "extension", url: "https://jobs.example.com/thanks", text: "Thank you" });
    const first = await app(appId);
    expect(first.confirmation).toMatchObject({ how: "extension", url: "https://jobs.example.com/thanks", text: "Thank you" });
    expect(await markSubmitted(userId, appId)).toBe("submitted");
    expect((await app(appId)).confirmation).toEqual(first.confirmation);
  });

  it("is a 404 for someone else's application", async () => {
    const { appId } = await seed("manual", [{ kind: "resume", prompt: "Resume", approved: true }]);
    await expect(markSubmitted(otherId, appId)).rejects.toMatchObject({ status: 404 });
  });
});
