import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { ApplicationStatus } from "@/lib/db/schema";
import { encrypt } from "@/lib/secrets";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
// No Chromium on the test machine: launching fails, which is one of the ways a fill stops.
const launch = vi.fn(async () => {
  throw new Error("Chromium isn't installed here");
});
vi.mock("playwright-core", () => ({ chromium: { launch } }));

const { preparePacket, shotDir, startFill } = await import("./submit");

let dataDir: string;
let userId: string;
let oppId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lookout-submit-"));
});
afterAll(async () => {
  await pg.close();
  await rm(dataDir, { recursive: true, force: true });
});
beforeEach(async () => {
  launch.mockClear();
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("APP_SECRET", "s".repeat(32));
  vi.stubEnv("APP_SECRET_PREVIOUS", "");
  await db.delete(schema.applications);
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "me@example.com", name: "Pat Lee" }).returning();
  await db.insert(schema.profiles).values({ userId });
  const [search] = await db.insert(schema.searches).values({ userId, name: "Job search", answers: {} }).returning();
  [{ id: oppId }] = await db.insert(schema.opportunities).values({ company: "Acme, Inc.", title: "Design Director", fingerprint: "acme-dd" }).returning();
  await db.insert(schema.userOpportunities).values({ userId, searchId: search.id, opportunityId: oppId, score: 4 });
});

type ItemSeed = { kind: schema.ApplicationItemKind; prompt: string; content: string; options?: string[]; required?: boolean; approved?: boolean };

/** One application with items, each with one version, approved unless told otherwise. */
async function seed(status: ApplicationStatus, items: ItemSeed[], applyUrl: string | null = "https://jobs.example.com/apply") {
  const [a] = await db.insert(schema.applications).values({ userId, opportunityId: oppId, status, route: "browser", report: applyUrl ? { applyUrl } : {} }).returning();
  for (const [position, s] of items.entries()) {
    const [it] = await db.insert(schema.applicationItems).values({ applicationId: a.id, kind: s.kind, prompt: s.prompt, required: s.required ?? true, options: s.options, position }).returning();
    const [v] = await db.insert(schema.itemVersions).values({ itemId: it.id, version: 1, content: s.content, author: "ai" }).returning();
    if (s.approved !== false && s.kind !== "eeo") await db.update(schema.applicationItems).set({ approvedVersionId: v.id }).where(eq(schema.applicationItems.id, it.id));
  }
  return a.id;
}

const app = async (id: string) => (await db.select().from(schema.applications).where(eq(schema.applications.id, id)))[0];
/** startFill runs in the background; wait until it has written its fill report. */
const settled = (id: string) => vi.waitFor(async () => {
  const a = await app(id);
  if (!a.report.fill) throw new Error("still filling");
  return a;
});

const RESUME = "# Pat Lee\npat@example.com\n\n## Experience\n### Design Lead, Beta Co\n- Led the design system.";
const EEO = { kind: "eeo" as const, prompt: "Veteran status", content: "", required: false, options: ["I am a veteran", "I am not a veteran", "Decline to self-identify"] };

describe("preparePacket", () => {
  it("lists approved items in form order and writes the resume and letter as .docx named for the person and company", async () => {
    const id = await seed("approved", [
      { kind: "resume", prompt: "Resume", content: RESUME },
      { kind: "cover_letter", prompt: "Cover letter", content: "Dear Acme,\n\nI'd like to help." },
      { kind: "field", prompt: "Phone", content: "555-0100" },
      { kind: "answer", prompt: "Anything else?", content: "Not yet approved", required: false, approved: false },
      { kind: "outreach", prompt: "Note to the hiring manager", content: "Hi!" },
    ]);
    const { steps } = await preparePacket(id);
    expect(steps.map((s) => [s.prompt, s.kind])).toEqual([
      ["Resume", "file"],
      ["Cover letter", "file"],
      ["Phone", "text"],
    ]);
    expect(path.dirname(steps[0].file!)).toBe(shotDir(id));
    expect((await readdir(shotDir(id))).sort()).toEqual(["Pat Lee - Acme Inc. Cover Letter.docx", "Pat Lee - Acme Inc. Resume.docx"]);
  });

  it("leaves EEO questions off the form without consent", async () => {
    await db.update(schema.profiles).set({ eeo: encrypt(JSON.stringify({ answers: { veteran: "Decline to self-identify" }, exact: {} })) }).where(eq(schema.profiles.userId, userId));
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }, EEO]);
    const { steps } = await preparePacket(id);
    expect(steps.map((s) => s.itemKind)).toEqual(["field"]);
  });

  it("fills EEO questions from the encrypted profile with consent, as optional choices", async () => {
    await db
      .update(schema.profiles)
      .set({ eeoConsent: true, eeo: encrypt(JSON.stringify({ answers: {}, exact: { "veteran status": "Decline to self-identify" } })) })
      .where(eq(schema.profiles.userId, userId));
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }, EEO]);
    const { steps } = await preparePacket(id);
    expect(steps[1]).toEqual({ prompt: "Veteran status", required: false, itemKind: "eeo", kind: "choice", content: "Decline to self-identify" });
  });
});

describe("startFill", () => {
  it("submit: with no application page it ends in manual with the reason, never submitted", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }], null);
    await startFill(id, "submit");
    const a = await settled(id);
    expect(a.status).toBe("manual");
    expect(a.submittedAt).toBeNull();
    expect(a.report.fill).toMatchObject({ mode: "submit", stopped: "No application page to open" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("submit: when the browser fails it ends in manual and the find stays where it was", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    await startFill(id, "submit");
    const a = await settled(id);
    expect(launch).toHaveBeenCalledOnce();
    expect(a.status).toBe("manual");
    expect(a.report.fill?.stopped).toBe("Chromium isn't installed here");
    expect(a.report.applyUrl).toBe("https://jobs.example.com/apply");
    const [uo] = await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, oppId));
    expect(uo.stage).toBe("Not applied");
  });

  it("submit: while filling, an approved application shows as submitting", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    // Hold the browser open so the status can be read mid-fill.
    let release = () => {};
    launch.mockImplementationOnce(() => new Promise((_, reject) => (release = () => reject(new Error("stopped")))));
    expect(await startFill(id, "submit")).toBe(true);
    expect((await app(id)).status).toBe("submitting");
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    release();
    expect((await settled(id)).status).toBe("manual");
  });

  /** Start a submit and hold the browser open; `release` stops the fill. */
  async function heldSubmit(id: string) {
    let release = () => {};
    launch.mockImplementationOnce(() => new Promise((_, reject) => (release = () => reject(new Error("stopped")))));
    expect(await startFill(id, "submit")).toBe(true);
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    return () => release();
  }

  it("submit: a fill that stops after the person marked it sent by hand keeps Submitted (#874)", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    const release = await heldSubmit(id);
    // The sweep handed it to the person (#864), who sent it and marked it.
    const at = new Date();
    await db.update(schema.applications).set({ status: "submitted", submittedAt: at, confirmation: { how: "manual", at: at.toISOString(), applyUrl: null, sent: [] } }).where(eq(schema.applications.id, id));
    release();
    const a = await settled(id);
    expect(a.status).toBe("submitted");
    expect(a.confirmation).toMatchObject({ how: "manual" });
    expect(a.report.fill?.stopped).toBe("stopped");
    expect(a.report.applyUrl).toBe("https://jobs.example.com/apply");
  });

  it("submit: a fill that stops after the person went back to editing keeps their status (#874)", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    const release = await heldSubmit(id);
    await db.update(schema.applications).set({ status: "needs_review" }).where(eq(schema.applications.id, id));
    release();
    const a = await settled(id);
    expect(a.status).toBe("needs_review");
    expect(a.report.fill?.stopped).toBe("stopped");
  });

  it.each(["needs_review", "manual", "submitting", "submitted"] as const)("submit: a %s application isn't sent and keeps its status", async (from) => {
    const id = await seed(from, [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    expect(await startFill(id, "submit")).toBe(false);
    const a = await app(id);
    expect(a.status).toBe(from);
    expect(a.report.fill).toBeUndefined();
    expect(launch).not.toHaveBeenCalled();
  });

  it("submit: two presses at once send it only once (#615)", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    const started = await Promise.all([startFill(id, "submit"), startFill(id, "submit")]);
    expect(started.filter(Boolean)).toHaveLength(1);
    await settled(id);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("test: records the fill report and keeps the status", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    await startFill(id, "test");
    const a = await settled(id);
    expect(a.status).toBe("approved");
    expect(a.report.fill).toMatchObject({ mode: "test", stopped: "Chromium isn't installed here" });
    expect(a.report.applyUrl).toBe("https://jobs.example.com/apply");
  });
});
