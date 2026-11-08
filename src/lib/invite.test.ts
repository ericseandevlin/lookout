import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
const sent = vi.hoisted(() => [] as { to: string; subject: string; text: string }[]);
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendMail: async (m: (typeof sent)[number]) => void sent.push(m) }));

const { createInvite } = await import("./invite");

let eric = { id: "", name: "Eric", email: "eric@example.com" };
let paul = { id: "", name: "", email: "paul@example.com" };
const inviteRow = async (email: string) => (await db.select().from(schema.invites).where(eq(schema.invites.email, email)))[0];
const tokenFrom = (link: string) => new URL(link).searchParams.get("token") ?? "";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  const [a, b] = await db
    .insert(schema.users)
    .values([{ email: eric.email, name: eric.name }, { email: paul.email }] as (typeof schema.users.$inferInsert)[])
    .returning();
  eric = { ...eric, id: a.id };
  paul = { ...paul, id: b.id };
  process.env.APP_URL = "https://lookout.example.com/";
});
afterEach(() => {
  sent.length = 0;
  delete process.env.SMTP_URL;
});
afterAll(async () => {
  delete process.env.APP_URL;
  await pg.close();
});

describe("createInvite (#404)", () => {
  it("records the invite and mints a one-time link on the app's origin", async () => {
    const r = await createInvite("new@example.com", eric, false);
    expect(r.email).toBe("new@example.com");
    expect(r.link).toMatch(/^https:\/\/lookout\.example\.com\/auth\/verify\?token=[\w-]{43}$/);
    const row = await inviteRow("new@example.com");
    expect(row.invitedBy).toBe(eric.id);
    expect(row.revokedAt).toBeNull();
  });

  it("stores only the token's hash, expiring in 7 days", async () => {
    const before = Date.now();
    const r = await createInvite("hash@example.com", eric, false);
    const raw = tokenFrom(r.link);
    const rows = await db.select().from(schema.loginTokens).where(eq(schema.loginTokens.email, "hash@example.com"));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256(raw));
    expect(rows[0].tokenHash).not.toContain(raw);
    expect(rows[0].purpose).toBe("login");
    expect(rows[0].usedAt).toBeNull();
    const days = (rows[0].expiresAt.getTime() - before) / 864e5;
    expect(days).toBeGreaterThanOrEqual(7);
    expect(days).toBeLessThan(7 + 1 / 1440);
    expect(r.expiresAt).toBe(rows[0].expiresAt.toISOString());
  });

  it("inviting again un-revokes, credits the new inviter and mints a fresh token", async () => {
    const first = await createInvite("again@example.com", eric, false);
    await db.update(schema.invites).set({ revokedAt: new Date() }).where(eq(schema.invites.email, "again@example.com"));
    const second = await createInvite("again@example.com", paul, false);
    const row = await inviteRow("again@example.com");
    expect(row.revokedAt).toBeNull();
    expect(row.invitedBy).toBe(paul.id);
    expect(tokenFrom(second.link)).not.toBe(tokenFrom(first.link));
    expect(await db.select().from(schema.invites).where(eq(schema.invites.email, "again@example.com"))).toHaveLength(1);
  });

  it("does not email when not asked, even with SMTP set", async () => {
    process.env.SMTP_URL = "smtp://mail.example.com";
    expect((await createInvite("quiet@example.com", eric, false)).emailed).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("does not email without SMTP, even when asked", async () => {
    expect((await createInvite("nosmtp@example.com", eric, true)).emailed).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("emails the link when asked and SMTP is set, signed with the inviter's name", async () => {
    process.env.SMTP_URL = "smtp://mail.example.com";
    const r = await createInvite("mail@example.com", eric, true);
    expect(r.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("mail@example.com");
    expect(sent[0].subject).toBe("Eric invited you to Lookout");
    expect(sent[0].text).toContain(r.link);
  });

  it("falls back to the inviter's email when they have no name", async () => {
    process.env.SMTP_URL = "smtp://mail.example.com";
    await createInvite("fallback@example.com", paul, true);
    expect(sent[0].subject).toBe("paul@example.com invited you to Lookout");
  });
});
