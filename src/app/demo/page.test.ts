import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { ReactElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { DEMO_EMAIL, DEMO_FINDS, DEMO_NAME, seedDemo } from "../../../scripts/demo-data";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));
vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ADMIN_EMAILS = "";
});
// The page only hands state to these client components; stand-ins keep the test to what the server decides.
vi.mock("@/components/store", () => ({ StoreProvider: () => null }));
vi.mock("@/components/Finds", () => ({ Finds: () => null }));
vi.spyOn(console, "info").mockImplementation(() => {});

const { default: Page } = await import("./page");
const { ensureDemo } = await import("@/lib/demo");

type ViewProps = { initial: { user: Record<string, unknown>; finds: unknown[]; running: unknown; run: unknown }; readOnly: boolean };
const view = () => Page() as Promise<ReactElement<ViewProps>>;
/** next/navigation's notFound() throws an error whose digest names the 404. */
const isNotFound = (e: unknown) => String((e as { digest?: string }).digest ?? "").includes("404");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.delete(schema.users);
  process.env.FEATURE_DEMO = "on";
});
afterEach(() => {
  delete process.env.FEATURE_DEMO;
});

describe("/demo (#1317)", () => {
  it("is not found while FEATURE_DEMO is off, even with the account there", async () => {
    await ensureDemo();
    delete process.env.FEATURE_DEMO;
    await expect(view()).rejects.toSatisfy(isNotFound);
  });

  it("is not found until the demo account is seeded", async () => {
    await expect(view()).rejects.toSatisfy(isNotFound);
  });

  it("will not show a demo-named account that can still sign in", async () => {
    await seedDemo(db, DEMO_EMAIL);
    await expect(view()).rejects.toSatisfy(isNotFound);
  });

  it("seeds Maya disabled, so nobody signs in to it and no scheduled search runs for it", async () => {
    await ensureDemo();
    await ensureDemo(); // a second startup rebuilds it, not a second account
    const rows = await db.select().from(schema.users);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: DEMO_EMAIL, name: DEMO_NAME, disabled: true, isAdmin: false });
  });

  it("hands the board over read only with nothing that acts on an account", async () => {
    await ensureDemo();
    const el = await view();
    expect(el.props.readOnly).toBe(true);
    expect(el.props.initial.finds).toHaveLength(DEMO_FINDS.length);
    expect(el.props.initial.user).toMatchObject({ isAdmin: false, autoApply: false, events: false, searches: false });
    expect(el.props.initial.running).toBeNull();
    expect(el.props.initial.run).toBeNull();
  });
});
