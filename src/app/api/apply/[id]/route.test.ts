import { describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";

vi.hoisted(() => {
  process.env.APP_URL = "https://lookout.test";
  process.env.ADMIN_EMAILS = "";
});
vi.mock("@/lib/db", () => ({ db: {}, schema }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://lookout.test" }) }));
let me: Partial<typeof schema.users.$inferSelect> | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => me, refreshSession: async () => {} }));
// As it will be once auto-apply opens to everyone, not only admins.
vi.mock("@/lib/apply", () => ({ canUseAutoApply: () => true, setAutoApplying: async () => {} }));
vi.mock("@/lib/application/review", () => ({ getApplicationDetail: async () => ({ id: "a1", report: { usd: 0.004, traps: [] } }) }));

const { GET } = await import("./route");
const get = async () => (await GET(new Request("https://lookout.test/api/apply/a1"), { params: Promise.resolve({ id: "a1" }) })).json();

describe("AI cost on the review page (#1531)", () => {
  it("is shown to admins only", async () => {
    me = { id: "u1", email: "admin@example.com", isAdmin: true, createdAt: new Date() };
    expect((await get()).report.usd).toBe(0.004);
    me = { id: "u2", email: "maya@example.com", isAdmin: false, createdAt: new Date() };
    const d = await get();
    expect(d.report.usd).toBeUndefined();
    expect(d.report.traps).toEqual([]);
  });
});
