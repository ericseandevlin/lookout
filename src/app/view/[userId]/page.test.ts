import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { ReactElement } from "react";
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
type User = typeof schema.users.$inferSelect;
let me: User | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me }));
// The page only hands state to these client components; stand-ins keep the test to what the server decides.
vi.mock("@/components/store", () => ({ StoreProvider: () => null }));
vi.mock("@/components/Finds", () => ({ Finds: () => null }));
vi.spyOn(console, "info").mockImplementation(() => {});

const { default: Page } = await import("./page");

type ViewProps = { initial: { user: Record<string, unknown>; running: unknown; run: unknown }; readOnly: boolean };
const view = (userId: string) => Page({ params: Promise.resolve({ userId }) }) as Promise<ReactElement<ViewProps>>;
const user = async (email: string, values: Partial<typeof schema.users.$inferInsert> = {}) => (await db.insert(schema.users).values({ email, ...values }).returning())[0];
/** next/navigation's notFound() throws an error whose digest names the 404. */
const isNotFound = (e: unknown) => String((e as { digest?: string }).digest ?? "").includes("404");

let admin: User, bob: User;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  admin = await user("admin@example.com", { isAdmin: true });
  bob = await user("bob@example.com", { isAdmin: true }); // an admin too, so the stripped flag shows
  me = admin;
});

describe("/view/[userId] (#537)", () => {
  it("is not found for a signed-out person or a non-admin", async () => {
    me = null;
    await expect(view(bob.id)).rejects.toSatisfy(isNotFound);
    me = await user("carol@example.com");
    await expect(view(bob.id)).rejects.toSatisfy(isNotFound);
  });

  it("is not found for a malformed or unknown id", async () => {
    await expect(view("not-an-id")).rejects.toSatisfy(isNotFound);
    await expect(view("00000000-0000-4000-8000-000000000000")).rejects.toSatisfy(isNotFound);
  });

  it("hands an admin the board read-only, with nothing that would act on the viewer's account", async () => {
    const el = await view(bob.id);
    expect(el.props.readOnly).toBe(true);
    const { user: u, running, run } = el.props.initial;
    expect(u).toMatchObject({ email: "bob@example.com", isAdmin: false, autoApply: false, events: false, searches: false });
    expect(running).toBeNull();
    expect(run).toBeNull();
  });
});
