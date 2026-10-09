import { and, desc, eq, gt } from "drizzle-orm";
import { authed, json } from "@/lib/api";
import { currentSessionHash } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { deviceName } from "@/lib/device";

export const GET = authed(async (_req, { user }) => {
  const current = await currentSessionHash();
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.lastSeenAt));
  return json({
    sessions: rows.map((s) => ({
      id: s.idHash.slice(0, 16),
      device: deviceName(s.userAgent),
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt ?? s.createdAt,
      current: s.idHash === current,
    })),
  });
});
