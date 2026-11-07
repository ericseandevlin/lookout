import { sqlClient } from "@/lib/db";

export const dynamic = "force-dynamic";

// Short commit baked into the image (Dockerfile GIT_COMMIT), so each deploy can confirm what is running.
const commit = process.env.GIT_COMMIT || null;

export async function GET() {
  try {
    await sqlClient`select 1`;
    return Response.json({ ok: true, commit });
  } catch {
    return Response.json({ ok: false, commit }, { status: 503 });
  }
}
