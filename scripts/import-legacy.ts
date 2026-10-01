/**
 * Import a board from the old pauljobs API format into a user's Lookout board.
 * Usage: tsx scripts/import-legacy.ts <email> <file.json>
 * Creates the user if needed. Safe to re-run: existing finds are left alone.
 */
import { readFileSync } from "node:fs";
import { sql as dsql } from "drizzle-orm";
import { fingerprint } from "../src/lib/agent/rules";
import { db, schema, sql } from "./db";

type Row = {
  company: string; role: string; location: string; comp: string; score: number; url: string;
  added: string; listed: string | null; summary: string; notes: string; pinned: number; archived: number;
};

const [email, file] = process.argv.slice(2);
if (!email || !file) {
  console.error("usage: tsx scripts/import-legacy.ts <email> <file.json>");
  process.exit(1);
}

const money = (s: string) => {
  const m = s.match(/\$?([\d,]+)\s*[-–]\s*\$?([\d,]+)/);
  return m ? [Number(m[1].replace(/,/g, "")), Number(m[2].replace(/,/g, ""))] : [null, null];
};

async function main() {
  const { rows } = JSON.parse(readFileSync(file, "utf8")) as { rows: Row[] };
  const e = email.trim().toLowerCase();
  let [user] = await db.select().from(schema.users).where(dsql`lower(${schema.users.email}) = ${e}`);
  if (!user) {
    [user] = await db.insert(schema.users).values({ email: e }).returning();
    await db.insert(schema.settings).values({ userId: user.id });
    await db.insert(schema.profiles).values({ userId: user.id });
    console.log(`created user ${e}`);
  }
  let added = 0;
  for (const r of rows) {
    const [min, max] = money(r.comp || "");
    const [opp] = await db
      .insert(schema.opportunities)
      .values({
        company: r.company, title: r.role, location: r.location, compMin: min, compMax: max,
        postedAt: r.listed && /^\d{4}-\d{2}-\d{2}$/.test(r.listed) ? r.listed : null,
        sourceUrl: r.url, description: r.summary ?? "", fingerprint: fingerprint(r.company, r.role, r.location),
      })
      .onConflictDoUpdate({ target: schema.opportunities.fingerprint, set: { sourceUrl: r.url } })
      .returning();
    const ins = await db
      .insert(schema.userOpportunities)
      .values({
        userId: user.id, opportunityId: opp.id, score: Math.max(1, Math.min(5, r.score || 3)),
        reasonsMatch: r.summary ? [r.summary] : [], reasonsGap: min ? [] : ["No comp posted"],
        pinned: !!r.pinned, archived: !!r.archived, notes: r.notes ?? "",
        addedAt: new Date(r.added + "T12:00:00Z"), addedVia: "import",
      })
      .onConflictDoNothing()
      .returning();
    added += ins.length;
  }
  console.log(`imported ${added} of ${rows.length} rows for ${e}`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
