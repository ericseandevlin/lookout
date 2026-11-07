import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Mail } from "@/lib/email";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
// Real email shell and escaping; only the send is caught.
const sendMail = vi.fn<(m: Mail) => Promise<void>>(async () => {});
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail }));

const { isOptedOut, optOut, readToken, sendNewsMail, unsubscribeParts } = await import("./bulkMail");
const { unsubscribeToken } = await import("@/lib/emailRules");

const SECRET = "s".repeat(32);
const OLD_SECRET = "o".repeat(32);
const news = { to: "Pat@Example.com", subject: "Lookout news", title: "What's new", bodyHtml: "<p>Hello</p>", text: "Hello" };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  sendMail.mockReset();
  vi.stubEnv("APP_URL", "https://lookout.example.com");
  vi.stubEnv("APP_SECRET", SECRET);
  vi.stubEnv("APP_SECRET_PREVIOUS", "");
  vi.stubEnv("MAIL_POSTAL_ADDRESS", "1 Main St, Springfield");
  await db.delete(schema.emailOptOuts);
  await db.delete(schema.users);
});

describe("sendNewsMail", () => {
  it("refuses to send without a postal address", async () => {
    vi.stubEnv("MAIL_POSTAL_ADDRESS", "  ");
    await expect(sendNewsMail(news)).rejects.toThrow(/MAIL_POSTAL_ADDRESS/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("skips an address that opted out, whatever its case", async () => {
    await optOut("news", "pat@example.com");
    expect(await sendNewsMail(news)).toBe("opted_out");
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("adds the unsubscribe link and postal address to text and html, and one-click headers", async () => {
    expect(await sendNewsMail(news)).toBe("sent");
    const [m] = sendMail.mock.calls[0];
    const t = unsubscribeToken(SECRET, "news", "pat@example.com");
    expect(m.to).toBe(news.to);
    expect(m.text).toMatch(/^Hello\n\n--\n/);
    expect(m.text).toContain(`Unsubscribe: https://lookout.example.com/unsubscribe?t=${t}`);
    expect(m.text).toContain("Lookout · 1 Main St, Springfield");
    expect(m.html).toContain("<p>Hello</p>");
    expect(m.html).toContain(`href="https://lookout.example.com/unsubscribe?t=${t}"`);
    expect(m.html).toContain("1 Main St, Springfield");
    expect(m.headers).toEqual({
      "List-Unsubscribe": `<https://lookout.example.com/api/unsubscribe?t=${t}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("refuses when APP_SECRET is missing or short, so links are always signed", async () => {
    vi.stubEnv("APP_SECRET", "short");
    await expect(sendNewsMail(news)).rejects.toThrow(/APP_SECRET/);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("optOut", () => {
  it("records a news opt-out once, normalized", async () => {
    await optOut("news", " Pat@Example.com ");
    await optOut("news", "pat@example.com", "admin");
    const rows = await db.select().from(schema.emailOptOuts);
    expect(rows).toEqual([expect.objectContaining({ email: "pat@example.com", source: "link" })]);
    expect(await isOptedOut("PAT@example.com")).toBe(true);
    expect(await isOptedOut("sam@example.com")).toBe(false);
  });

  it("turns off the finds email for the matching account only", async () => {
    const [pat] = await db.insert(schema.users).values({ email: "Pat@Example.com" }).returning();
    const [sam] = await db.insert(schema.users).values({ email: "sam@example.com" }).returning();
    await db.insert(schema.settings).values([
      { userId: pat.id, digest: true },
      { userId: sam.id, digest: true },
    ]);
    await optOut("digest", "pat@example.com");
    const digest = async (id: string) => (await db.select().from(schema.settings).where(eq(schema.settings.userId, id)))[0].digest;
    expect(await digest(pat.id)).toBe(false);
    expect(await digest(sam.id)).toBe(true);
    // A digest opt-out doesn't stop news mail.
    expect(await isOptedOut("pat@example.com")).toBe(false);
  });
});

describe("readToken", () => {
  it("reads a token from unsubscribeParts", () => {
    const { headers } = unsubscribeParts("digest", "Pat@Example.com", "Why.");
    const t = headers["List-Unsubscribe"].match(/t=([^>]+)>/)![1];
    expect(readToken(t)).toEqual({ list: "digest", email: "pat@example.com" });
  });

  it("still accepts a token signed with the previous secret during a rotation", () => {
    const t = unsubscribeToken(OLD_SECRET, "news", "pat@example.com");
    expect(readToken(t)).toBeNull();
    vi.stubEnv("APP_SECRET_PREVIOUS", OLD_SECRET);
    expect(readToken(t)).toEqual({ list: "news", email: "pat@example.com" });
  });
});
