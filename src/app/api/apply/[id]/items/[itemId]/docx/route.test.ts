import { PGlite } from "@electric-sql/pglite";
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
// The Word layout has its own tests; here only which draft goes in, and with what header.
const draftToDocx = vi.fn(async (md: string, _title: string, _opts?: { letterHeader?: { name: string; contact: string } }) => Buffer.from(md));
vi.mock("@/lib/application/docx", () => ({ draftToDocx }));

const { GET } = await import("./route");

type User = typeof schema.users.$inferSelect;
type Kind = (typeof schema.APPLICATION_ITEM_KINDS)[number];
let alice: User, bob: User;

const download = (id: string, itemId: string) =>
  GET(new Request(`https://lookout.test/api/apply/${id}/items/${itemId}/docx`), { params: Promise.resolve({ id, itemId }) });
const user = async (email: string, name = "", isAdmin = true) => (await db.insert(schema.users).values({ email, name, isAdmin }).returning())[0];
const application = async (u: User, company = "Acme") => {
  const [o] = await db.insert(schema.opportunities).values({ type: "job", company, title: "Designer", fingerprint: crypto.randomUUID() }).returning();
  return (await db.insert(schema.applications).values({ userId: u.id, opportunityId: o.id }).returning())[0];
};
const item = async (applicationId: string, kind: Kind) => (await db.insert(schema.applicationItems).values({ applicationId, kind, prompt: kind }).returning())[0];
const version = async (itemId: string, n: number, content: string) =>
  (await db.insert(schema.itemVersions).values({ itemId, version: n, content, author: "ai" }).returning())[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  process.env.FEATURE_AUTO_APPLY = "on";
  draftToDocx.mockClear();
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  alice = await user("alice@example.com", "Alice Doe");
  bob = await user("bob@example.com");
  me = alice;
});

describe("GET /api/apply/[id]/items/[itemId]/docx gate (#465)", () => {
  it("needs a session", async () => {
    me = null;
    expect((await download(crypto.randomUUID(), crypto.randomUUID())).status).toBe(401);
  });

  it("is 404 while auto-apply is off or outside the beta", async () => {
    const a = await application(alice);
    const it = await item(a.id, "resume");
    await version(it.id, 1, "# Alice Doe");
    process.env.FEATURE_AUTO_APPLY = "off";
    expect((await download(a.id, it.id)).status).toBe(404);
    process.env.FEATURE_AUTO_APPLY = "on";
    me = await user("carol@example.com", "", false);
    expect((await download(a.id, it.id)).status).toBe(404);
  });

  it("is 404 for a malformed id or someone else's application", async () => {
    const a = await application(bob);
    const it = await item(a.id, "resume");
    await version(it.id, 1, "# Bob");
    expect((await download("not-a-uuid", it.id)).status).toBe(404);
    expect((await download(a.id, it.id)).status).toBe(404);
    expect(draftToDocx).not.toHaveBeenCalled();
  });

  it("is 404 for an item from another application", async () => {
    const mine = await application(alice);
    const theirs = await application(bob);
    const it = await item(theirs.id, "resume");
    await version(it.id, 1, "# Bob");
    expect((await download(mine.id, it.id)).status).toBe(404);
    expect(draftToDocx).not.toHaveBeenCalled();
  });

  it("is 404 for an item that isn't a resume or cover letter", async () => {
    const a = await application(alice);
    const it = await item(a.id, "answer");
    await version(it.id, 1, "Because I like it.");
    expect((await download(a.id, it.id)).status).toBe(404);
  });

  it("is 404 when nothing is drafted yet", async () => {
    const a = await application(alice);
    const it = await item(a.id, "resume");
    expect((await download(a.id, it.id)).status).toBe(404);
    await version(it.id, 1, "   ");
    expect((await download(a.id, it.id)).status).toBe(404);
  });
});

describe("GET /api/apply/[id]/items/[itemId]/docx (#465)", () => {
  it("sends the latest draft as a Word file", async () => {
    const a = await application(alice);
    const it = await item(a.id, "resume");
    await version(it.id, 1, "first");
    await version(it.id, 2, "second");
    const res = await download(a.id, it.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("second");
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Alice Doe - Acme Resume.docx"');
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends the approved version over a newer one", async () => {
    const a = await application(alice);
    const it = await item(a.id, "resume");
    const v1 = await version(it.id, 1, "approved");
    await version(it.id, 2, "newer");
    await db.update(schema.applicationItems).set({ approvedVersionId: v1.id });
    expect(await (await download(a.id, it.id)).text()).toBe("approved");
  });

  it("heads a cover letter with the name and contact line from the resume", async () => {
    const a = await application(alice);
    const resume = await item(a.id, "resume");
    await version(resume.id, 1, "# Alice M. Doe\nalice@example.com | Brooklyn, NY\n\n## Experience");
    const letter = await item(a.id, "cover_letter");
    await version(letter.id, 1, "Dear team,");
    const res = await download(a.id, letter.id);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Alice Doe - Acme Cover Letter.docx"');
    const header = draftToDocx.mock.calls[0][2]?.letterHeader;
    expect(header?.name).toBe("Alice M. Doe");
    expect(header?.contact).toContain("alice@example.com");
  });

  it("keeps the file name safe for disk and for the header", async () => {
    me = await user("dana@example.com", "Dana Ünal");
    const a = await application(me, 'Foo/Bar: "Baz"');
    const it = await item(a.id, "resume");
    await version(it.id, 1, "# Dana");
    const res = await download(a.id, it.id);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="Dana nal - Foo-Bar- -Baz- Resume.docx"');
  });
});
