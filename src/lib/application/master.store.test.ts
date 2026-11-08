import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Usage } from "@/lib/ai/llm";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
const completeJSON = vi.fn();
vi.mock("@/lib/ai/llm", () => ({ completeJSON }));

const { buildMaster, confirmMaster, discardMaster, ensureMaster, getMaster } = await import("./master");

const RESUME = `Dana Reyes
Product Designer
dana@example.com • New York, NY
Senior Designer, Acme | New York, NY | 01/2020 – 06/2024
- Led the redesign of the checkout flow for 2 million shoppers
- Built the design system the whole product team ships with`;

const REBUILT = `# Dana Reyes
Product Designer
dana@example.com • New York, NY
## Experience
### Senior Designer, Acme | New York, NY | 01/2020 – 06/2024
- Led the redesign of the checkout flow for 2 million shoppers
- Built the design system the whole product team ships with`;

const usage = (): Usage => ({ input: 0, output: 0, searches: 0, usd: 0 });
let userId = "";

const setResume = async (text: string) => {
  await db.delete(schema.materials).where(eq(schema.materials.userId, userId));
  await db.insert(schema.materials).values({ userId, kind: "resume", extracted: { text } });
};
const stored = async () => (await db.select({ m: schema.profiles.masterResume }).from(schema.profiles).where(eq(schema.profiles.userId, userId)))[0].m;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  const [u] = await db.insert(schema.users).values({ email: "dana@example.com" }).returning();
  userId = u.id;
  await db.insert(schema.profiles).values({ userId });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  completeJSON.mockReset();
  completeJSON.mockResolvedValue({ resume: REBUILT, uncertain: [] });
  await db.update(schema.profiles).set({ masterResume: null }).where(eq(schema.profiles.userId, userId));
  await db.delete(schema.materials).where(eq(schema.materials.userId, userId));
});

describe("buildMaster (#131)", () => {
  it("does nothing without an uploaded resume", async () => {
    expect(await buildMaster(userId, usage())).toBeNull();
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("stores the rebuild as an unconfirmed working copy with the model's doubts", async () => {
    await setResume(RESUME);
    completeJSON.mockResolvedValue({ resume: REBUILT, uncertain: ["I wasn't sure about the Acme dates."] });
    const m = await buildMaster(userId, usage());
    expect(m?.md).toContain("### Senior Designer, Acme");
    expect(m?.edited).toBe(false);
    expect(m?.confirmed).toBeUndefined();
    expect(m?.uncertain).toContain("I wasn't sure about the Acme dates.");
    expect(await stored()).toEqual(m);
  });

  it("sends the LinkedIn profile only when there is one", async () => {
    await setResume(RESUME);
    await buildMaster(userId, usage());
    expect(completeJSON.mock.calls[0][0].user).not.toContain("<linkedin_profile");
    await db.insert(schema.materials).values({ userId, kind: "linkedin", extracted: { text: "Dana Reyes, Senior Designer at Acme" } });
    await buildMaster(userId, usage());
    expect(completeJSON.mock.calls[1][0].user).toContain("Dana Reyes, Senior Designer at Acme");
  });

  it("keeps the confirmed version when it rebuilds", async () => {
    await setResume(RESUME);
    await buildMaster(userId, usage());
    const ok = await confirmMaster(userId, REBUILT);
    completeJSON.mockResolvedValue({ resume: `${REBUILT}\n- A new bullet from the rebuild`, uncertain: [] });
    const again = await buildMaster(userId, usage());
    expect(again?.md).toContain("A new bullet from the rebuild");
    expect(again?.confirmed).toEqual(ok.confirmed);
  });
});

describe("ensureMaster", () => {
  it("builds the first time, then reads what's stored without another model call", async () => {
    await setResume(RESUME);
    expect((await ensureMaster(userId, usage()))?.built).toBe(true);
    const second = await ensureMaster(userId, usage());
    expect(second?.built).toBe(false);
    expect(second?.md).toContain("Senior Designer, Acme");
    expect(completeJSON).toHaveBeenCalledTimes(1);
  });

  it("gives drafts the confirmed version, not a newer unconfirmed rebuild", async () => {
    await setResume(RESUME);
    await confirmMaster(userId, REBUILT);
    completeJSON.mockResolvedValue({ resume: `${REBUILT}\n- Unchecked bullet`, uncertain: [] });
    await buildMaster(userId, usage());
    expect((await ensureMaster(userId, usage()))?.md).not.toContain("Unchecked bullet");
  });

  it("returns null with no resume and nothing built", async () => {
    expect(await ensureMaster(userId, usage())).toBeNull();
  });
});

describe("getMaster", () => {
  it("flags the master stale once a different resume is uploaded", async () => {
    await setResume(RESUME);
    await buildMaster(userId, usage());
    expect((await getMaster(userId)).stale).toBe(false);
    await setResume(`${RESUME}\n- One more line`);
    expect((await getMaster(userId)).stale).toBe(true);
  });

  it("is not stale when nothing is built", async () => {
    await setResume(RESUME);
    expect(await getMaster(userId)).toEqual({ master: null, stale: false });
  });
});

describe("confirmMaster", () => {
  it("confirms the person's text, clears the doubts and marks hand edits", async () => {
    await setResume(RESUME);
    completeJSON.mockResolvedValue({ resume: REBUILT, uncertain: ["Check the Acme dates."] });
    const built = await buildMaster(userId, usage());
    const edited = `${REBUILT}\n- Mentored four designers  `;
    const m = await confirmMaster(userId, edited);
    expect(m.md).toBe(edited.trim());
    expect(m.confirmed?.md).toBe(edited.trim());
    expect(m.uncertain).toEqual([]);
    expect(m.edited).toBe(true);
    expect(m.fromHash).toBe(built?.fromHash);
  });

  it("confirming the rebuild as it stands is not an edit", async () => {
    await setResume(RESUME);
    const built = await buildMaster(userId, usage());
    expect((await confirmMaster(userId, built!.md)).edited).toBe(false);
  });
});

describe("discardMaster", () => {
  it("goes back to the confirmed version", async () => {
    await setResume(RESUME);
    const ok = await confirmMaster(userId, REBUILT);
    completeJSON.mockResolvedValue({ resume: `${REBUILT}\n- Unchecked bullet`, uncertain: ["A doubt"] });
    await buildMaster(userId, usage());
    const back = await discardMaster(userId);
    expect(back?.md).toBe(REBUILT);
    expect(back?.uncertain).toEqual([]);
    expect(back?.confirmed).toEqual(ok.confirmed);
    expect(await stored()).toEqual(back);
  });

  it("clears an unconfirmed rebuild when nothing was ever confirmed", async () => {
    await setResume(RESUME);
    await buildMaster(userId, usage());
    expect(await discardMaster(userId)).toBeNull();
    expect(await stored()).toBeNull();
  });
});
