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
  process.env.APP_SECRET = "t".repeat(32);
});
const sent: { to: string; text: string; headers?: Record<string, string> }[] = [];
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail: async (m: (typeof sent)[number]) => void sent.push(m) }));

const { POST } = await import("./route");
const { sendNewsMail, unsubscribeParts } = await import("@/lib/bulkMail");

const tokenFor = (list: "news" | "digest", email: string) => new URL(unsubscribeParts(list, email, "Why.").headers["List-Unsubscribe"].slice(1, -1)).searchParams.get("t")!;
// A one-click unsubscribe from a mail app: a form post with no Origin header.
const oneClick = (t: string) =>
  POST(new Request(`https://lookout.test/api/unsubscribe?t=${encodeURIComponent(t)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
const news = { to: "a@example.com", subject: "News", title: "News", bodyHtml: "<p>Hi</p>", text: "Hi" };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  sent.length = 0;
  delete process.env.MAIL_POSTAL_ADDRESS;
  await db.delete(schema.emailOptOuts);
  await db.delete(schema.users);
});

describe("POST /api/unsubscribe (#28)", () => {
  it("adds the address to the news opt-out list, without an Origin header", async () => {
    const res = await oneClick(tokenFor("news", "A@Example.com"));
    expect(res.status).toBe(200);
    expect(await db.select({ email: schema.emailOptOuts.email }).from(schema.emailOptOuts)).toEqual([{ email: "a@example.com" }]);
    expect((await oneClick(tokenFor("news", "a@example.com"))).status).toBe(200);
  });

  it("turns off the finds email for that account only", async () => {
    const [a, b] = await db.insert(schema.users).values([{ email: "A@example.com" }, { email: "b@example.com" }]).returning();
    await db.insert(schema.settings).values([{ userId: a.id }, { userId: b.id }]);
    expect((await oneClick(tokenFor("digest", "a@example.com"))).status).toBe(200);
    const digest = async (id: string) => (await db.select().from(schema.settings).where(eq(schema.settings.userId, id)))[0].digest;
    expect(await digest(a.id)).toBe(false);
    expect(await digest(b.id)).toBe(true);
    expect(await db.select().from(schema.emailOptOuts)).toEqual([]);
  });

  it("refuses a changed token", async () => {
    const t = tokenFor("news", "a@example.com");
    expect((await oneClick(t.slice(0, -2) + "xx")).status).toBe(400);
    expect(await db.select().from(schema.emailOptOuts)).toEqual([]);
  });
});

describe("sendNewsMail (#28)", () => {
  it("won't send without a postal address", async () => {
    await expect(sendNewsMail(news)).rejects.toThrow(/MAIL_POSTAL_ADDRESS/);
    expect(sent).toEqual([]);
  });

  it("sends with the address, an unsubscribe link and one-click headers", async () => {
    process.env.MAIL_POSTAL_ADDRESS = "PO Box 1, New York, NY 10001";
    expect(await sendNewsMail(news)).toBe("sent");
    expect(sent[0].text).toContain("PO Box 1, New York, NY 10001");
    expect(sent[0].text).toContain("https://lookout.test/unsubscribe?t=news.");
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("skips an address that unsubscribed", async () => {
    process.env.MAIL_POSTAL_ADDRESS = "PO Box 1, New York, NY 10001";
    await oneClick(tokenFor("news", "a@example.com"));
    expect(await sendNewsMail({ ...news, to: "A@example.com" })).toBe("opted_out");
    expect(sent).toEqual([]);
  });
});
