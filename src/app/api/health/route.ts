import { statfs } from "node:fs/promises";
import { sqlClient } from "@/lib/db";
import { env, envNumber } from "@/lib/env";

export const dynamic = "force-dynamic";

// Short commit baked into the image (Dockerfile GIT_COMMIT), so each deploy can confirm what is running.
const commit = process.env.GIT_COMMIT || null;

/**
 * "low" once the disk holding the data folder is DISK_ALERT_PERCENT full (default 85), the way `df` counts it.
 * The uptime check (#12) opens a GitHub issue on "low" (#995). Only the word is public, never the numbers.
 * A full disk is not an outage, so it never changes `ok`.
 */
async function diskStatus(): Promise<"ok" | "low" | "unknown"> {
  try {
    const s = await statfs(env.dataDir);
    const used = s.blocks - s.bfree;
    const usable = used + s.bavail;
    if (usable <= 0) return "unknown";
    return (used / usable) * 100 >= envNumber("DISK_ALERT_PERCENT", 85) ? "low" : "ok";
  } catch {
    return "unknown";
  }
}

export async function GET() {
  const disk = await diskStatus();
  try {
    await sqlClient`select 1`;
    return Response.json({ ok: true, commit, disk });
  } catch {
    return Response.json({ ok: false, commit, disk }, { status: 503 });
  }
}
