import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn(async () => [{ "?column?": 1 }]);
vi.mock("@/lib/db", () => ({ sqlClient: () => query() }));
const statfs = vi.fn();
vi.mock("node:fs/promises", () => ({ statfs: (p: string) => statfs(p) }));

const { GET } = await import("./route");

// 100 blocks: `used` of them in use, 5 more reserved for root (like ext4), the rest free for the app.
function disk(used: number) {
  return { blocks: 100, bfree: 100 - used, bavail: 95 - used };
}

describe("/api/health disk (#995)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    query.mockClear();
  });

  it("says ok under the threshold", async () => {
    statfs.mockResolvedValueOnce(disk(70));
    expect(await (await GET()).json()).toMatchObject({ ok: true, disk: "ok" });
  });

  it("says low at 85%, counting the root reserve the way df does", async () => {
    // 81 used of 81 + 14 usable = 85.3%, though 81 of 100 raw blocks is only 81%.
    statfs.mockResolvedValueOnce(disk(81));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, disk: "low" });
  });

  it("follows DISK_ALERT_PERCENT", async () => {
    vi.stubEnv("DISK_ALERT_PERCENT", "70");
    statfs.mockResolvedValueOnce(disk(70));
    expect((await (await GET()).json()).disk).toBe("low");
  });

  it("says unknown when the disk can't be read, and stays up", async () => {
    statfs.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await (await GET()).json()).toMatchObject({ ok: true, disk: "unknown" });
  });

  it("shows only the word, never sizes", async () => {
    statfs.mockResolvedValueOnce(disk(90));
    expect(Object.keys(await (await GET()).json()).sort()).toEqual(["commit", "disk", "ok"]);
  });

  it("still reports disk when the database is down", async () => {
    query.mockRejectedValueOnce(new Error("down"));
    statfs.mockResolvedValueOnce(disk(90));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, disk: "low" });
  });
});
