import { describe, expect, it } from "vitest";
import { latestOnly, nextPoll, pickBoardRun } from "./runState";

const run = (trigger: string, status: string, id = trigger + status) => ({ id, trigger, status });

describe("pickBoardRun (#256)", () => {
  it("skips resume scans", () => {
    expect(pickBoardRun([run("resume", "done"), run("manual", "done")])?.trigger).toBe("manual");
    expect(pickBoardRun([run("resume", "running")])).toBeNull();
  });

  it("keeps following an active search when a newer run already finished", () => {
    // The agent claimed both; the link add finished first and sorts newest.
    expect(pickBoardRun([run("url", "done"), run("manual", "running")])?.trigger).toBe("manual");
  });

  it("falls back to the newest finished run", () => {
    expect(pickBoardRun([run("manual", "done", "b"), run("scheduled", "done", "a")])?.id).toBe("b");
    expect(pickBoardRun([])).toBeNull();
  });
});

describe("nextPoll", () => {
  it("reloads the board once the run is no longer queued or running", () => {
    expect(nextPoll(run("manual", "queued"))).toBe("progress");
    expect(nextPoll(run("manual", "running"))).toBe("progress");
    expect(nextPoll(run("manual", "done"))).toBe("reload");
    expect(nextPoll(run("manual", "failed"))).toBe("reload");
    expect(nextPoll(null)).toBe("reload");
  });
});

describe("latestOnly", () => {
  it("drops a stale response that lands after a newer one", async () => {
    const resolvers: ((v: string) => void)[] = [];
    const applied: string[] = [];
    const refresh = latestOnly(() => new Promise<string>((r) => resolvers.push(r)), (v) => applied.push(v));
    const first = refresh(); // started before the finds were saved
    const second = refresh(); // started after the search finished
    resolvers[1]("with finds");
    await second;
    resolvers[0]("empty board");
    await first;
    expect(applied).toEqual(["with finds"]);
  });
});
