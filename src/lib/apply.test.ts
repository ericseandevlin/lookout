import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/application/run", () => ({ kick: vi.fn() }));
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

const { queueApplication, setAutoApplying } = await import("./apply");

let userId = "";
let searchId = "";
const opp = async (url: string, stage: schema.Stage = "Not applied") => {
  const [o] = await db.insert(schema.opportunities).values({ title: "Role", company: "Acme", sourceUrl: url, fingerprint: url } as typeof schema.opportunities.$inferInsert).returning();
  await db.insert(schema.userOpportunities).values({ userId, searchId, opportunityId: o.id, stage, score: 5 } as typeof schema.userOpportunities.$inferInsert);
  return o.id;
};
const stageOf = async (id: string) =>
  (await db.select().from(schema.userOpportunities).where(and(eq(schema.userOpportunities.userId, userId), eq(schema.userOpportunities.opportunityId, id))))[0].stage;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  const [u] = await db.insert(schema.users).values({ email: "eric@example.com", name: "Eric" } as typeof schema.users.$inferInsert).returning();
  userId = u.id;
  // The board belongs to a search now (#8).
  const [s] = await db.insert(schema.searches).values({ userId, name: "Job search" } as typeof schema.searches.$inferInsert).returning();
  searchId = s.id;
});
afterAll(async () => {
  await pg.close();
});

describe("Auto-applying stage (#182)", () => {
  it("queuing moves a Not applied find to Auto-applying, and canceling moves it back", async () => {
    const id = await opp("https://example.com/jobs/1");
    await queueApplication(userId, id, "auto");
    expect(await stageOf(id)).toBe("Auto-applying");
    await setAutoApplying(userId, id, false);
    expect(await stageOf(id)).toBe("Not applied");
  });
  it("never overwrites a stage the user picked", async () => {
    const id = await opp("https://example.com/jobs/2", "Interview");
    await queueApplication(userId, id, "user");
    expect(await stageOf(id)).toBe("Interview");
    await setAutoApplying(userId, id, false);
    expect(await stageOf(id)).toBe("Interview");
  });
});
