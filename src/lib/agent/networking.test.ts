import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Context } from "./discover";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

type Draft = { title: string; host: string; startsOn: string; endsOn: string; time: string; place: string; online: boolean; cost: string; why: string; url: string; fit: number; miles: number | null };
// The model returns whatever a test sets here.
let drafts: Draft[] = [];
const completeJSON = vi.fn(async () => ({ events: drafts }));
vi.mock("@/lib/ai/llm", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/llm")>()), completeJSON }));
// Web search finds two pages; fetching returns enough text to count as read.
const webSearch = vi.fn(async () => [{ url: "https://events.example.com/a" }, { url: "https://events.example.com/b" }]);
vi.mock("@/lib/ai/search", () => ({ webSearch }));
const fetchPage = vi.fn(async (url: string) => ({ html: `Events listed at ${url}. ${"Details. ".repeat(40)}` }));
vi.mock("@/lib/ai/fetchPage", () => ({ fetchPage, pageToText: (html: string) => html }));

const { clearEvents, findEvents, findEventsIfDue, getEventPrefs, listEvents } = await import("./networking");
const { emptyUsage } = await import("@/lib/ai/llm");

const ymd = (days: number) => new Date(Date.now() + days * 24 * 3600_000).toISOString().slice(0, 10);
const draft = (title: string, over: Partial<Draft> = {}): Draft => ({
  title,
  host: "Design Guild",
  startsOn: ymd(7),
  endsOn: "",
  time: "6:30 pm",
  place: "Brooklyn, NY",
  online: false,
  cost: "Free",
  why: "Design leaders",
  url: "https://events.example.com/a",
  fit: 4,
  miles: 3,
  ...over,
});
const step = async () => {};

let userId: string;
let ctx: Context;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  completeJSON.mockClear();
  webSearch.mockClear();
  fetchPage.mockClear();
  drafts = [];
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "pat@example.com" }).returning();
  await db.insert(schema.profiles).values({ userId, eventInterests: "design systems, accessibility", eventReach: "both" });
  ctx = { userId, brief: "Design director", searchProfile: { where: "New York, NY" } } as unknown as Context;
});

/** An event already on the board. */
async function event(title: string, o: { startsOn?: string; endsOn?: string | null; pinned?: boolean; archived?: boolean; dismissed?: boolean } = {}) {
  const startsOn = o.startsOn ?? ymd(7);
  await db.insert(schema.networkingEvents).values({ userId, title, startsOn, endsOn: o.endsOn ?? null, url: "https://events.example.com/x", fingerprint: `${startsOn}:${title.toLowerCase()}`, pinned: o.pinned ?? false, archived: o.archived ?? false, dismissed: o.dismissed ?? false });
}
const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe("getEventPrefs", () => {
  it("falls back to defaults when there is no profile", async () => {
    await db.delete(schema.profiles);
    expect(await getEventPrefs(userId)).toEqual({ interests: "", reach: "both", miles: 25, freq: "weekly" });
  });
});

describe("listEvents", () => {
  it("drops past events by end date, or by start date when there's no end", async () => {
    await event("Tomorrow", { startsOn: ymd(1) });
    await event("Today", { startsOn: ymd(0) });
    await event("Last week", { startsOn: ymd(-7) });
    await event("Multi-day, still on", { startsOn: ymd(-2), endsOn: ymd(1) });
    await event("Multi-day, over", { startsOn: ymd(-5), endsOn: ymd(-1) });
    expect(titles(await listEvents(userId))).toEqual(["Multi-day, still on", "Today", "Tomorrow"]);
    expect(await db.select().from(schema.networkingEvents)).toHaveLength(3);
  });

  it("hides dismissed events but keeps archived ones for the board to filter, soonest first", async () => {
    await event("Later", { startsOn: ymd(9) });
    await event("Soon", { startsOn: ymd(2), archived: true });
    await event("Dismissed", { startsOn: ymd(3), dismissed: true });
    expect((await listEvents(userId)).map((e) => e.title)).toEqual(["Soon", "Later"]);
  });
});

describe("clearEvents", () => {
  it("archives unpinned events only and counts them", async () => {
    await event("Pinned", { pinned: true });
    await event("Plain one");
    await event("Plain two");
    await event("Already archived", { archived: true });
    expect(await clearEvents(userId)).toBe(2);
    const rows = await db.select().from(schema.networkingEvents);
    expect(titles(rows.filter((r) => !r.archived))).toEqual(["Pinned"]);
    expect(rows).toHaveLength(4);
  });
});

describe("findEvents", () => {
  it("does nothing and costs nothing without interests", async () => {
    await db.update(schema.profiles).set({ eventInterests: "" }).where(eq(schema.profiles.userId, userId));
    expect(await findEvents(ctx, emptyUsage(), step)).toBe(0);
    expect(webSearch).not.toHaveBeenCalled();
    expect(completeJSON).not.toHaveBeenCalled();
  });

  it("adds events from pages it read and records when it searched", async () => {
    drafts = [draft("Design Systems Night"), draft("Accessibility Panel", { url: "https://events.example.com/b", online: true, place: "", miles: 10 })];
    expect(await findEvents(ctx, emptyUsage(), step)).toBe(2);
    const rows = await db.select().from(schema.networkingEvents);
    expect(titles(rows)).toEqual(["Accessibility Panel", "Design Systems Night"]);
    const online = rows.find((r) => r.online)!;
    expect(online).toMatchObject({ place: "Online", miles: null });
    const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
    expect(p.eventsSearchedAt).toBeInstanceOf(Date);
    expect(webSearch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("skips events from pages it never read, and ones already on the board", async () => {
    await event("Design Systems Night");
    drafts = [draft("Design Systems Night"), draft("Made Up Event", { url: "https://elsewhere.example.com/" }), draft("New Meetup")];
    expect(await findEvents(ctx, emptyUsage(), step)).toBe(1);
    expect(titles(await db.select().from(schema.networkingEvents))).toEqual(["Design Systems Night", "New Meetup"]);
  });

  it("skips the model call when no page could be read", async () => {
    fetchPage.mockRejectedValue(new Error("timeout"));
    expect(await findEvents(ctx, emptyUsage(), step)).toBe(0);
    expect(completeJSON).not.toHaveBeenCalled();
    fetchPage.mockReset();
    fetchPage.mockImplementation(async (url: string) => ({ html: `Events listed at ${url}. ${"Details. ".repeat(40)}` }));
  });
});

describe("findEventsIfDue", () => {
  it("skips when the weekly event search ran two days ago", async () => {
    await db.update(schema.profiles).set({ eventsSearchedAt: new Date(Date.now() - 2 * 864e5) }).where(eq(schema.profiles.userId, userId));
    expect(await findEventsIfDue(ctx, emptyUsage(), step)).toBeNull();
    expect(webSearch).not.toHaveBeenCalled();
  });

  it("runs when the last weekly search was eight days ago", async () => {
    await db.update(schema.profiles).set({ eventsSearchedAt: new Date(Date.now() - 8 * 864e5) }).where(eq(schema.profiles.userId, userId));
    drafts = [draft("Design Systems Night")];
    expect(await findEventsIfDue(ctx, emptyUsage(), step)).toBe(1);
  });
});
