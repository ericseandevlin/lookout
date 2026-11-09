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
// The rebuild is one model call; the budget check has its own tests.
const completeJSON = vi.fn<(...a: unknown[]) => Promise<{ resume: string; uncertain: string[] }>>();
vi.mock("@/lib/ai/llm", async (real) => ({ ...(await real<typeof import("@/lib/ai/llm")>()), completeJSON }));
const assertBudget = vi.fn<(userId: string) => Promise<void>>(async () => {});
vi.mock("@/lib/ai/runs", async (real) => ({ ...(await real<typeof import("@/lib/ai/runs")>()), assertBudget }));

const route = await import("./route");

const RESUME = `Dana Reyes
Product Designer
dana@example.com • New York, NY
Senior Designer, Acme | New York, NY | 01/2020 – 06/2024
- Led the redesign of the checkout flow for 2 million shoppers`;

const REBUILT = `# Dana Reyes
Product Designer
dana@example.com • New York, NY
## Experience
### Senior Designer, Acme | New York, NY | 01/2020 – 06/2024
- Led the redesign of the checkout flow for 2 million shoppers`;

const MINE = `${REBUILT}\n- Built the design system the whole product team ships with`;

const url = "https://lookout.test/api/profile/master-resume";
const get = () => route.GET(new Request(url), {});
const build = () => route.POST(new Request(url, { method: "POST" }), {});
const save = (md: string) => route.PUT(new Request(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ md }) }), {});
const discard = () => route.DELETE(new Request(url, { method: "DELETE" }), {});
const setResume = async (text: string) => {
  await db.delete(schema.materials).where(eq(schema.materials.userId, me!.id));
  await db.insert(schema.materials).values({ userId: me!.id, kind: "resume", extracted: { text } });
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  completeJSON.mockReset();
  completeJSON.mockResolvedValue({ resume: REBUILT, uncertain: [] });
  assertBudget.mockClear();
  await db.delete(schema.users);
  [me] = await db.insert(schema.users).values({ email: "dana@example.com", isAdmin: true }).returning();
  await db.insert(schema.profiles).values({ userId: me.id });
});

describe("/api/profile/master-resume gate (#555)", () => {
  const all = () => [get(), build(), save(MINE), discard()];

  it("needs a session", async () => {
    me = null;
    expect((await Promise.all(all())).map((r) => r.status)).toEqual([401, 401, 401, 401]);
  });

  it("is 404 on every method while auto-apply is off or outside the beta", async () => {
    process.env.FEATURE_AUTO_APPLY = "off";
    expect((await Promise.all(all())).map((r) => r.status)).toEqual([404, 404, 404, 404]);
    process.env.FEATURE_AUTO_APPLY = "on";
    [me] = await db.insert(schema.users).values({ email: "carol@example.com" }).returning();
    expect((await Promise.all(all())).map((r) => r.status)).toEqual([404, 404, 404, 404]);
    expect(completeJSON).not.toHaveBeenCalled();
  });
});

describe("/api/profile/master-resume (#555)", () => {
  it("shows an empty view before anything is built", async () => {
    expect(await (await get()).json()).toEqual({
      md: null,
      confirmed: false,
      confirmedAt: null,
      hasConfirmed: false,
      stale: false,
      at: null,
      uncertain: [],
      unplaced: [],
      template: "modern",
      accent: null,
    });
  });

  it("needs an uploaded resume to build", async () => {
    expect((await build()).status).toBe(400);
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("builds after the budget check, then confirms the person's text", async () => {
    await setResume(RESUME);
    completeJSON.mockResolvedValueOnce({ resume: REBUILT, uncertain: ["Check the Acme dates"] });
    const built = await (await build()).json();
    expect(assertBudget).toHaveBeenCalledWith(me!.id);
    expect(built).toMatchObject({ md: REBUILT, confirmed: false, hasConfirmed: false, stale: false, uncertain: ["Check the Acme dates"] });

    const res = await save(MINE);
    const saved = await res.json();
    expect(saved).toMatchObject({ md: MINE, confirmed: true, hasConfirmed: true, stale: false, uncertain: [] });
    expect(saved.confirmedAt).toBe(saved.at);
    expect(await (await get()).json()).toEqual(saved);
  });

  it("refuses text under 40 characters", async () => {
    expect((await save("  # Dana Reyes  ")).status).toBe(400);
    expect((await get()).status).toBe(200);
    expect((await (await get()).json()).md).toBeNull();
  });

  it("keeps the confirmed version through a rebuild, and goes back to it on discard", async () => {
    await setResume(RESUME);
    const confirmedAt = (await (await save(MINE)).json()).confirmedAt;

    const rebuilt = await (await build()).json();
    expect(rebuilt).toMatchObject({ md: REBUILT, confirmed: false, hasConfirmed: true, confirmedAt });

    expect(await (await discard()).json()).toMatchObject({ md: MINE, confirmed: true, confirmedAt });
  });

  it("discarding with nothing confirmed leaves nothing built", async () => {
    await setResume(RESUME);
    await build();
    expect((await (await discard()).json()).md).toBeNull();
  });

  it("is stale once a newer resume is uploaded", async () => {
    await setResume(RESUME);
    await build();
    await setResume(`${RESUME}\n- Started a design guild`);
    expect((await (await get()).json()).stale).toBe(true);
  });

  it("lists unplaced lines and the saved template and accent", async () => {
    await db.insert(schema.settings).values({ userId: me!.id, autoApply: { enabled: false, threshold: 4, dailyCap: 5, template: "cool", accent: "0a7cff" } });
    const view = await (await save(`${MINE}\n## Unplaced\n- Ran a design meetup\n- Taught a UX course`)).json();
    expect(view).toMatchObject({ unplaced: ["Ran a design meetup", "Taught a UX course"], template: "cool", accent: "0a7cff" });
  });
});
