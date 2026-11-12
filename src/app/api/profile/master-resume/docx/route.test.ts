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
// The Word layout has its own tests; here only which resume goes in, and with what look.
const draftToDocx = vi.fn<(md: string, title: string, opts?: { template?: string; accent?: string }) => Promise<Buffer>>(async (md) => Buffer.from(md));
vi.mock("@/lib/application/docx", () => ({ draftToDocx }));

const { GET } = await import("./route");

const MD = `# Dana Reyes
Product Designer
## Experience
### Senior Designer, Acme | New York, NY | 01/2020 – 06/2024
- Led the redesign of the checkout flow for 2 million shoppers`;

const download = () => GET(new Request("https://lookout.test/api/profile/master-resume/docx"), {});
const setMaster = (userId: string, md: string, confirmed?: string) =>
  db
    .update(schema.profiles)
    .set({ masterResume: { md, fromHash: "h", edited: false, at: new Date().toISOString(), uncertain: [], ...(confirmed ? { confirmed: { md: confirmed, at: new Date().toISOString() } } : {}) } as schema.MasterResume })
    .where(eq(schema.profiles.userId, userId));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  draftToDocx.mockClear();
  await db.delete(schema.users);
  [me] = await db.insert(schema.users).values({ email: "dana@example.com", name: "Dana Reyes", isAdmin: true }).returning();
  await db.insert(schema.profiles).values({ userId: me.id });
});

describe("GET /api/profile/master-resume/docx (#780)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await download()).status).toBe(401);
  });

  it("is not there while auto-apply is off", async () => {
    await setMaster(me!.id, MD);
    process.env.FEATURE_AUTO_APPLY = "off";
    expect((await download()).status).toBe(404);
  });

  it("is a 404 before the master resume is built", async () => {
    const res = await download();
    expect(res.status).toBe(404);
    expect(draftToDocx).not.toHaveBeenCalled();
  });

  it("downloads the resume on the page as a Word file named for the person", async () => {
    await setMaster(me!.id, MD);
    const res = await download();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Dana Reyes - Resume.docx"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(MD);
  });

  it("gives the version shown, also when an older one is the confirmed one", async () => {
    await setMaster(me!.id, MD, "# Dana Reyes\nolder confirmed version of the resume text");
    expect(await (await download()).text()).toBe(MD);
  });

  it("uses the person's template and color", async () => {
    await setMaster(me!.id, MD);
    await db.insert(schema.settings).values({ userId: me!.id, autoApply: { template: "cool", accent: "#1F6FEB" } as never });
    await download();
    expect(draftToDocx.mock.calls[0][2]).toMatchObject({ template: "cool", accent: "#1F6FEB" });
  });

  it("never gives another person's resume", async () => {
    const [bob] = await db.insert(schema.users).values({ email: "bob@example.com", isAdmin: true }).returning();
    await db.insert(schema.profiles).values({ userId: bob.id });
    await setMaster(bob.id, "# Bob\nBob's resume, which Dana must never get in a download");
    expect((await download()).status).toBe(404);
  });
});
