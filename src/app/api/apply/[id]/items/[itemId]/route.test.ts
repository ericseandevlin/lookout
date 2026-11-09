import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "@/lib/db/schema";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ADMIN_EMAILS = "";
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "https://lookout.test" }),
}));
let me: typeof schema.users.$inferSelect | null = null;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => me,
  refreshSession: async () => {},
}));
// The review steps and redrafts have their own tests and call the model; here only which one each action reaches.
const steps = vi.hoisted(() => {
  const step = <T>(result: T) =>
    vi.fn<(...a: unknown[]) => Promise<T>>(async () => result);
  return {
    editItem: step("needs_review"),
    reviseItem: step({ status: "needs_review", versionId: "v2" }),
    analyzeItem: step({ analysis: { score: 80 } }),
    approveItem: step("approved"),
    redraftLetter: step(undefined),
    redraftResume: step(undefined),
  };
});
vi.mock("@/lib/application/review", async (real) => {
  const { editItem, reviseItem, analyzeItem, approveItem } = steps;
  return {
    ...(await real<typeof import("@/lib/application/review")>()),
    editItem,
    reviseItem,
    analyzeItem,
    approveItem,
  };
});
vi.mock("@/lib/application/run", () => ({
  redraftLetter: steps.redraftLetter,
  redraftResume: steps.redraftResume,
}));

const { POST } = await import("./route");

type User = typeof schema.users.$inferSelect;
type App = typeof schema.applications.$inferSelect;
type Kind = (typeof schema.APPLICATION_ITEM_KINDS)[number];
let alice: User;

const send = (id: string, itemId: string, data: unknown) =>
  POST(
    new Request(`https://lookout.test/api/apply/${id}/items/${itemId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    }),
    {
      params: Promise.resolve({ id, itemId }),
    },
  );
const user = async (email: string, isAdmin = true) =>
  (await db.insert(schema.users).values({ email, isAdmin }).returning())[0];
const application = async (u: User, status: App["status"] = "needs_review") => {
  const [o] = await db
    .insert(schema.opportunities)
    .values({
      type: "job",
      company: "Acme",
      title: "Designer",
      fingerprint: crypto.randomUUID(),
    })
    .returning();
  return (
    await db
      .insert(schema.applications)
      .values({ userId: u.id, opportunityId: o.id, status })
      .returning()
  )[0];
};
const item = async (applicationId: string, kind: Kind) =>
  (
    await db
      .insert(schema.applicationItems)
      .values({ applicationId, kind, prompt: kind })
      .returning()
  )[0];

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../../../../../drizzle"),
  });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  Object.values(steps).forEach((f) => f.mockClear());
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  alice = await user("alice@example.com");
  me = alice;
});

describe("POST /api/apply/[id]/items/[itemId] gate (#553)", () => {
  const ids = [crypto.randomUUID(), crypto.randomUUID()] as const;

  it("needs a session", async () => {
    me = null;
    expect((await send(...ids, { action: "redraft" })).status).toBe(401);
  });

  it("is 404 while auto-apply is off or outside the beta", async () => {
    process.env.FEATURE_AUTO_APPLY = "off";
    expect((await send(...ids, { action: "edit", content: "x" })).status).toBe(
      404,
    );
    process.env.FEATURE_AUTO_APPLY = "on";
    me = await user("carol@example.com", false);
    expect((await send(...ids, { action: "edit", content: "x" })).status).toBe(
      404,
    );
    expect(steps.editItem).not.toHaveBeenCalled();
  });

  it.each([
    { action: "nope" },
    { action: "edit" },
    { action: "edit", content: "x".repeat(40_001) },
    { action: "revise", instruction: " a " },
    { action: "approve", versionId: "v1" },
    { action: "analyze" },
  ])("refuses %j", async (data) => {
    expect((await send(...ids, data)).status).toBe(400);
  });
});

describe("POST /api/apply/[id]/items/[itemId] actions (#553)", () => {
  it("passes edit, revise, analyze and approve to their review step", async () => {
    const [a, i, v] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    expect(
      await (
        await send(a, i, {
          action: "edit",
          content: "# Alice",
          note: "Tighter",
        })
      ).json(),
    ).toEqual({ status: "needs_review" });
    expect(steps.editItem).toHaveBeenCalledWith(
      alice.id,
      a,
      i,
      "# Alice",
      "Tighter",
    );
    await send(a, i, { action: "edit", content: "# Alice" });
    expect(steps.editItem).toHaveBeenLastCalledWith(
      alice.id,
      a,
      i,
      "# Alice",
      "",
    );

    expect(
      await (
        await send(a, i, { action: "revise", instruction: "  Shorter  " })
      ).json(),
    ).toEqual({ status: "needs_review", versionId: "v2" });
    expect(steps.reviseItem).toHaveBeenCalledWith(alice.id, a, i, "Shorter");

    expect(
      await (await send(a, i, { action: "analyze", versionId: v })).json(),
    ).toEqual({ analysis: { score: 80 } });
    expect(steps.analyzeItem).toHaveBeenCalledWith(alice.id, a, i, v);

    expect(
      await (await send(a, i, { action: "approve", versionId: v })).json(),
    ).toEqual({ status: "approved" });
    expect(steps.approveItem).toHaveBeenCalledWith(alice.id, a, i, v);
    await send(a, i, { action: "approve", versionId: null });
    expect(steps.approveItem).toHaveBeenLastCalledWith(alice.id, a, i, null);
  });

  it("redrafts the resume or the cover letter and returns the status", async () => {
    const a = await application(alice, "approved");
    const resume = await item(a.id, "resume");
    const letter = await item(a.id, "cover_letter");
    // A redraft sends an approved application back to review.
    steps.redraftResume.mockImplementationOnce(async () => {
      await db
        .update(schema.applications)
        .set({ status: "needs_review" })
        .where(eq(schema.applications.id, a.id));
    });
    expect(
      await (await send(a.id, resume.id, { action: "redraft" })).json(),
    ).toEqual({ status: "needs_review" });
    expect(steps.redraftResume).toHaveBeenCalledWith(a.id);
    expect(
      await (await send(a.id, letter.id, { action: "redraft" })).json(),
    ).toEqual({ status: "needs_review" });
    expect(steps.redraftLetter).toHaveBeenCalledWith(a.id);
  });

  it("only redrafts the resume and cover letter", async () => {
    const a = await application(alice);
    const answer = await item(a.id, "answer");
    expect((await send(a.id, answer.id, { action: "redraft" })).status).toBe(
      400,
    );
    // An item from another application counts as none.
    const other = await item((await application(alice)).id, "resume");
    expect((await send(a.id, other.id, { action: "redraft" })).status).toBe(
      400,
    );
    expect(steps.redraftResume).not.toHaveBeenCalled();
    expect(steps.redraftLetter).not.toHaveBeenCalled();
  });

  it("will not redraft someone else's application, one already sent or canceled, or one still being drafted (#580)", async () => {
    const bobs = await application(await user("bob@example.com"));
    expect(
      (
        await send(bobs.id, (await item(bobs.id, "resume")).id, {
          action: "redraft",
        })
      ).status,
    ).toBe(404);
    for (const status of ["submitting", "submitted", "canceled", "queued", "scanning", "drafting"] as const) {
      const a = await application(alice, status);
      expect(
        (
          await send(a.id, (await item(a.id, "resume")).id, {
            action: "redraft",
          })
        ).status,
      ).toBe(409);
    }
    expect(steps.redraftResume).not.toHaveBeenCalled();
  });
});
