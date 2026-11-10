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

// The page the link answers with: HTML, or an error to throw.
let page: string | Error = "";
const fetchPage = vi.fn(async (url: string) => {
  if (page instanceof Error) throw page;
  return { url, html: page };
});
vi.mock("@/lib/ai/fetchPage", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/fetchPage")>()), fetchPage: (u: string) => fetchPage(u) }));

const { FetchError } = await import("@/lib/ai/fetchPage");
const { readLink } = await import("./links");

const URL = "https://sam.example.com/work";
const article = (words: number) => `<html><head><title>Sam's work</title></head><body><p>${"Designed a calmer checkout. ".repeat(words)}</p></body></html>`;
let id = "";

const material = async () => (await db.select().from(schema.materials).where(eq(schema.materials.id, id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  page = "";
  fetchPage.mockClear();
  await db.delete(schema.users);
  const [u] = await db.insert(schema.users).values({ email: "sam@example.com" }).returning();
  const [m] = await db
    .insert(schema.materials)
    .values({ userId: u.id, kind: "link", url: URL, status: "failed", filledNote: "old note", extracted: { text: "old text" } })
    .returning();
  id = m.id;
});

describe("readLink", () => {
  it("keeps the page text and marks the link done", async () => {
    page = article(20);
    await readLink(id, URL);
    const m = await material();
    expect(fetchPage).toHaveBeenCalledWith(URL);
    expect(m.status).toBe("done");
    expect(m.filledNote).toBeNull();
    expect(m.extracted?.text).toContain("TITLE: Sam's work");
    expect(m.extracted?.text).toContain("Designed a calmer checkout.");
    expect(m.scannedAt).toBeInstanceOf(Date);
  });

  it("reads a link saved without https:// (#664)", async () => {
    page = article(20);
    await readLink(id, "sam.example.com/work");
    expect(fetchPage).toHaveBeenCalledWith("https://sam.example.com/work");
    expect((await material()).status).toBe("done");
  });

  it("fails a thin page and says why", async () => {
    page = article(3);
    await readLink(id, URL);
    const m = await material();
    expect(m.status).toBe("failed");
    expect(m.filledNote).toBe("Not enough text on the page to use");
    expect(m.extracted).toBeNull();
  });

  it("doesn't count the title toward the minimum", async () => {
    page = `<html><head><title>${"A long page title that goes on. ".repeat(10)}</title></head><body><p>Hi.</p></body></html>`;
    await readLink(id, URL);
    expect((await material()).filledNote).toBe("Not enough text on the page to use");
  });

  it.each([401, 403, 429, 999])("says the site blocks apps on %i", async (status) => {
    page = new FetchError(`The page answered ${status}`);
    await readLink(id, URL);
    const m = await material();
    expect(m.status).toBe("failed");
    expect(m.filledNote).toBe("This site blocks apps from reading it");
  });

  it.each([new FetchError("The page answered 404"), new FetchError("That address isn't allowed"), new Error("socket hang up"), "not an error"])(
    "says it couldn't open the page on any other failure (%s)",
    async (err) => {
      fetchPage.mockRejectedValueOnce(err);
      await readLink(id, URL);
      const m = await material();
      expect(m.status).toBe("failed");
      expect(m.filledNote).toBe("Couldn't open this page");
      expect(m.extracted).toBeNull();
    },
  );

  it("shows the link as scanning while it reads", async () => {
    let during: string | null | undefined;
    fetchPage.mockImplementationOnce(async (url: string) => {
      during = (await material()).status;
      return { url, html: article(20) };
    });
    await readLink(id, URL);
    expect(during).toBe("scanning");
  });
});
