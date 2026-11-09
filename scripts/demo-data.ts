/**
 * The made-up demo account behind the README screenshots (#415): Maya Ortiz, an events lead in New York,
 * with one saved job search and eight finds at fictional venues. No real people or companies, no model calls.
 * Used by scripts/seed-demo.ts; kept apart so a test can seed an in-memory Postgres with it.
 */
import { eq, sql as dsql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { fingerprint } from "../src/lib/agent/rules";
import * as schema from "../src/lib/db/schema";
import { acceptedNow } from "../src/lib/legal";

type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export const DEMO_EMAIL = "demo@example.com";
export const DEMO_NAME = "Maya Ortiz";

const answers: schema.ProfileAnswers = {
  q1: "Director of Events at a flagship venue, owning sales and production, leading a larger team",
  floor: "140000",
  target: "180000",
  modes: ["Hybrid", "On-site"],
  area: "New York City, Brooklyn, Jersey City",
  q4: "Rebuilt the private events team and grew event revenue 38% in two years",
  q5: "No relocation. No more than 20% travel. No commission-heavy pay",
};

const searchProfile: schema.SearchProfile = {
  summary: "Events lead with eight years running private and corporate events at New York venues, ready to own a venue's whole events program.",
  targetTitles: ["Director of Events", "Head of Private Events", "Director of Event Sales", "Events Director"],
  seniority: "Director",
  industries: ["Hospitality", "Museums and cultural venues", "Hotels", "Conference centers"],
  strengths: ["Event sales", "Team building", "Vendor management", "Budget ownership"],
  proof: ["Grew private event revenue 38% in two years", "Built and led a team of 9", "Ran 300+ events a year"],
  where: "Hybrid or on-site in New York City, Brooklyn or Jersey City",
  pay: "Floor $140,000 base; would jump for $180,000",
  avoid: ["Relocation", "More than 20% travel", "Commission-heavy pay"],
  searchTerms: ["director of events new york", "head of private events", "events director brooklyn"],
};

type DemoFind = {
  company: string;
  title: string;
  location: string;
  workMode: string;
  comp: [number, number];
  postedDaysAgo: number;
  score: number;
  stage: schema.Stage;
  seen: boolean;
  pinned?: boolean;
  notes?: string;
  feedback?: string;
  description: string;
  reasonsMatch: string[];
  reasonsGap: string[];
};

/** The eight finds on the README board, top to bottom. */
export const DEMO_FINDS: DemoFind[] = [
  {
    company: "Harbor Hall", title: "Director of Events", location: "Brooklyn, NY", workMode: "On-site", comp: [165000, 190000],
    postedDaysAgo: 1, score: 5, stage: "Not applied", seen: false, pinned: true,
    description: "Lead events for a 1,200-person waterfront venue: sales, production and a team of 12.",
    reasonsMatch: ["Owns sales and production, the step up you named", "Team of 12, larger than your current 9", "Pay is above your target"],
    reasonsGap: ["Asks for concert experience; your work is mostly private events"],
  },
  {
    company: "The Linden Museum", title: "Head of Private Events", location: "Manhattan, NY", workMode: "Hybrid", comp: [150000, 172000],
    postedDaysAgo: 2, score: 5, stage: "Applied", seen: false,
    notes: "Applied Nov 6. Mentioned the gala rebuild in the cover letter.",
    description: "Run private rentals, galas and member events across the museum's three event spaces.",
    reasonsMatch: ["Private events at a cultural venue, your strongest area", "Hybrid in Manhattan", "Revenue target matches your 38% growth story"],
    reasonsGap: [],
  },
  {
    company: "Northline Hotels", title: "Director of Event Sales", location: "Manhattan, NY", workMode: "On-site", comp: [145000, 165000],
    postedDaysAgo: 3, score: 4, stage: "Interview", seen: false,
    notes: "First call with the GM went well. Panel next week.",
    description: "Own group and event sales for two Midtown hotels, with a sales team of six.",
    reasonsMatch: ["Event sales leadership", "Above your floor"],
    reasonsGap: ["Sales only, no production", "Hotel group sales is new for you"],
  },
  {
    company: "Copper & Pine", title: "Events Director", location: "Brooklyn, NY", workMode: "On-site", comp: [135000, 150000],
    postedDaysAgo: 4, score: 4, stage: "Not applied", seen: true,
    description: "Lead weddings and private dining events for a restaurant group with four Brooklyn locations.",
    reasonsMatch: ["Runs the whole events program", "Close to home in Brooklyn"],
    reasonsGap: ["Low end of the range is under your floor"],
  },
  {
    company: "Atlas Conference Center", title: "VP, Events and Partnerships", location: "Jersey City, NJ", workMode: "Hybrid", comp: [180000, 210000],
    postedDaysAgo: 5, score: 4, stage: "Not applied", seen: true,
    description: "Lead the events team and corporate partnerships for a 60,000 square foot conference center.",
    reasonsMatch: ["VP title, a real step up", "Pay at or above your target"],
    reasonsGap: ["Partnerships half of the role is new for you", "Up to 25% travel, over your 20% limit"],
  },
  {
    company: "Riverside Gardens", title: "Director of Special Events", location: "Bronx, NY", workMode: "On-site", comp: [140000, 160000],
    postedDaysAgo: 7, score: 4, stage: "Applied", seen: true,
    description: "Plan and run the garden's seasonal festivals, galas and private rentals.",
    reasonsMatch: ["Galas and private rentals", "Owns the events budget"],
    reasonsGap: ["Bronx commute is long from Brooklyn"],
  },
  {
    company: "Greenpoint Terminal", title: "Senior Manager, Venue Programs", location: "Brooklyn, NY", workMode: "On-site", comp: [125000, 140000],
    postedDaysAgo: 2, score: 3, stage: "Not applied", seen: true,
    description: "Program markets, pop-ups and private events in a converted warehouse venue.",
    reasonsMatch: ["Brooklyn venue", "Mix of public and private events"],
    reasonsGap: ["Senior manager, not director", "Pay is under your floor"],
  },
  {
    company: "Saltwater Supper Club", title: "Private Dining Director", location: "Manhattan, NY", workMode: "On-site", comp: [120000, 135000],
    postedDaysAgo: 6, score: 2, stage: "Nope", seen: true,
    feedback: "Mostly nights and weekends, and it's a step sideways",
    description: "Sell and run private dining for a 200-seat restaurant.",
    reasonsMatch: ["Private event sales"],
    reasonsGap: ["Pay is under your floor", "Smaller scope than your current role"],
  },
];

const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * 864e5);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Create the demo account, or rebuild it from scratch if it's already there. Refuses to touch an account
 * with the same email that isn't the demo one, so it can't wipe a real person's board.
 */
export async function seedDemo(db: Db, email = DEMO_EMAIL, now = new Date()) {
  const e = email.trim().toLowerCase();
  const [existing] = await db.select().from(schema.users).where(dsql`lower(${schema.users.email}) = ${e}`);
  if (existing && existing.name !== DEMO_NAME) throw new Error(`${e} belongs to an account that isn't the demo one; pick another email`);

  return db.transaction(async (tx) => {
    // Starting over keeps re-runs identical: the cascade clears the old search, board, runs and sessions.
    if (existing) await tx.delete(schema.users).where(eq(schema.users.id, existing.id));
    const [user] = await tx
      .insert(schema.users)
      .values({ email: e, name: DEMO_NAME, createdAt: daysAgo(now, 30), onboardedAt: daysAgo(now, 30), ...acceptedNow() })
      .returning();
    const [search] = await tx
      .insert(schema.searches)
      .values({ userId: user.id, name: "Job search", answers, savedAt: daysAgo(now, 30), searchProfile, searchProfileAt: daysAgo(now, 30) })
      .returning();
    await tx.insert(schema.settings).values({ userId: user.id, activeSearchId: search.id });
    await tx.insert(schema.profiles).values({ userId: user.id });
    // A resume already read, so the board skips the Getting started panel (no file behind it; nothing reads one).
    await tx.insert(schema.materials).values({
      userId: user.id, kind: "resume", fileName: "Maya Ortiz resume.pdf", mime: "application/pdf", status: "done", scannedAt: daysAgo(now, 30),
      filledNote: "Filled in team size and venue capacity", createdAt: daysAgo(now, 30),
      extracted: { summary: "Events manager, 8 years in Brooklyn venues: private events, weddings and corporate buyouts, team of 9." },
    });

    for (const f of DEMO_FINDS) {
      const posted = daysAgo(now, f.postedDaysAgo);
      const row = {
        company: f.company, title: f.title, location: f.location, workMode: f.workMode, compMin: f.comp[0], compMax: f.comp[1],
        postedAt: isoDate(posted), description: f.description, fingerprint: fingerprint(f.company, f.title, f.location),
      };
      // Opportunities are shared across accounts, so refresh the posting in place rather than duplicate it.
      const [opp] = await tx
        .insert(schema.opportunities)
        .values(row)
        .onConflictDoUpdate({ target: schema.opportunities.fingerprint, set: { postedAt: row.postedAt, compMin: row.compMin, compMax: row.compMax, description: row.description } })
        .returning();
      await tx.insert(schema.userOpportunities).values({
        userId: user.id, searchId: search.id, opportunityId: opp.id, score: f.score, reasonsMatch: f.reasonsMatch, reasonsGap: f.reasonsGap,
        stage: f.stage, pinned: f.pinned ?? false, notes: f.notes ?? "", feedback: f.feedback ? { reason: f.feedback, at: now.toISOString() } : null,
        seenAt: f.seen ? now : null, addedAt: posted,
      });
    }

    // One finished search, so "See search report" has something to show.
    const added = DEMO_FINDS.length;
    await tx.insert(schema.runs).values({
      userId: user.id, searchId: search.id, trigger: "scheduled", status: "done", startedAt: daysAgo(now, 1), finishedAt: daysAgo(now, 1),
      found: 31, added, progress: { pct: 100, step: "Done", log: [] },
      report: {
        queries: searchProfile.searchTerms, results: 64, picked: 31, read: 31,
        tally: { postings: 27, notPostings: 4, known: 14, dealbreaker: 5, belowFloor: 2, offLocation: 3, added },
        tips: [{ text: "Five postings asked for more than 20% travel. If that limit can bend, say so on Questions.", href: "/profile", label: "Questions" }],
      },
    });
    return { userId: user.id, searchId: search.id, finds: added };
  });
}
