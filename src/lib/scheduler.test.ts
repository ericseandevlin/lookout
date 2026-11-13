import { beforeEach, describe, expect, it, vi } from "vitest";

// A pool where each reserved connection records its own queries, so the test can see which session took the lock.
type Conn = { id: number; queries: string[]; released: boolean };
const conns: Conn[] = [];
let lockFree = true;
const pooled: string[] = [];
const sqlClient = Object.assign(
  (strings: TemplateStringsArray) => {
    pooled.push(strings.join("?"));
    return Promise.resolve([{ locked: true }]);
  },
  {
    reserve: async () => {
      const c: Conn = { id: conns.length, queries: [], released: false };
      conns.push(c);
      return Object.assign(
        (strings: TemplateStringsArray) => {
          const q = strings.join("?");
          c.queries.push(q);
          return Promise.resolve([{ locked: q.includes("try_advisory_lock") ? lockFree : true }]);
        },
        { release: () => void (c.released = true) },
      );
    },
  },
);
vi.mock("@/lib/db", () => ({ db: {}, schema: {}, sqlClient }));

let aiConfig: () => Promise<{ provider: string; model: string }> = async () => ({ provider: "anthropic", model: "" });
vi.mock("@/lib/config", () => ({ getAiConfig: () => aiConfig() }));
vi.mock("@/lib/retention", () => ({ cleanup: async () => ({ loginTokens: 0, sessions: 0, runLogs: 0, errors: 0 }) }));
vi.mock("@/lib/errorLog", () => ({ recordError: async () => {} }));
vi.mock("@/lib/agent/discover", () => ({ discover: vi.fn(), isRunning: vi.fn() }));
vi.mock("@/lib/digest", () => ({ sendDigest: vi.fn() }));
vi.mock("@/lib/spendAlerts", () => ({ checkKeyLimit: async () => {} }));
vi.mock("@/lib/application/run", () => ({ sweepApplications: vi.fn() }));

const { tick } = await import("./scheduler");

beforeEach(() => {
  conns.length = 0;
  pooled.length = 0;
  lockFree = true;
  aiConfig = async () => ({ provider: "anthropic", model: "" });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("scheduler tick lock (#316)", () => {
  it("locks and unlocks on the same reserved connection, then releases it", async () => {
    await tick();
    expect(conns).toHaveLength(1);
    expect(conns[0].queries).toEqual(["select pg_try_advisory_lock(?) as locked", "select pg_advisory_unlock(?)"]);
    expect(conns[0].released).toBe(true);
    expect(pooled.filter((q) => q.includes("advisory"))).toEqual([]);
  });

  it("skips the pass and releases the connection when another tick holds the lock", async () => {
    lockFree = false;
    aiConfig = vi.fn(aiConfig);
    await tick();
    expect(aiConfig).not.toHaveBeenCalled();
    expect(conns[0].queries).toEqual(["select pg_try_advisory_lock(?) as locked"]);
    expect(conns[0].released).toBe(true);
  });

  it("unlocks and releases even when the pass throws", async () => {
    aiConfig = async () => {
      throw new Error("db down");
    };
    await expect(tick()).rejects.toThrow("db down");
    expect(conns[0].queries.at(-1)).toBe("select pg_advisory_unlock(?)");
    expect(conns[0].released).toBe(true);
  });
});
