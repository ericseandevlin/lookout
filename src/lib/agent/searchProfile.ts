import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import type { SearchProfile } from "@/lib/db/schema";
import { kinds } from "@/lib/kinds";
import { AiConfigError, completeJSON, type Usage } from "@/lib/ai/llm";
import { getAiConfig } from "@/lib/config";

/**
 * The search profile is what every search actually uses: one compact picture of
 * the person, built by the model from their answers, resume, LinkedIn PDF and
 * links. It's rebuilt only when those inputs change, and shown to the user on
 * Profile > What Lookout sees, so nothing about a search is hidden.
 */

// Bump to rebuild everyone's profile after a prompt change.
const VERSION = 2;

export type RawInputs = {
  answers: Record<string, string | string[]>;
  brief: string;
  resume: string;
  linkedin: string;
  links: { url: string; text: string }[];
  /** Their notes on finds, each with the bullets it sits under. Only feedback gets used (see the corrections field). */
  notes: string[];
  sources: { answers: number; resume: boolean; linkedin: boolean; links: number; notes: number };
  hash: string;
};

/** Their notes on finds, for the profile build only. Most notes are private jottings; the model keeps only feedback about Lookout. */
const notesBlock = (notes: string[]) =>
  notes.length
    ? `\n<their_notes_on_finds>\n${notes.join("\n---\n")}\n</their_notes_on_finds>`
    : "";

export async function loadRawInputs(userId: string): Promise<RawInputs & { stored: typeof schema.profiles.$inferSelect | undefined }> {
  const [p] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const mats = await db.select().from(schema.materials).where(eq(schema.materials.userId, userId));
  const resume = mats.find((m) => m.kind === "resume");
  const li = mats.find((m) => m.kind === "linkedin");
  const answers = p?.answers ?? {};
  const kind = kinds[p?.kind ?? "job"];
  // Use the resume text even when the AI summary step never ran.
  const resumeText = [resume?.extracted?.summary, (resume?.extracted?.text ?? "").slice(0, 6000)].filter(Boolean).join("\n\n");
  const linkedin = (li?.extracted?.text ?? "").slice(0, 5000);
  const links = mats
    .filter((m) => m.kind === "link" && m.url && m.extracted?.text)
    .slice(0, 4)
    .map((m) => ({ url: m.url!, text: m.extracted!.text!.slice(0, 1500) }));
  const noted = await db
    .select({
      title: schema.opportunities.title,
      company: schema.opportunities.company,
      notes: schema.userOpportunities.notes,
      ok: schema.userOpportunities.reasonsMatch,
      gap: schema.userOpportunities.reasonsGap,
    })
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(and(eq(schema.userOpportunities.userId, userId), ne(schema.userOpportunities.notes, "")))
    .orderBy(desc(schema.userOpportunities.addedAt))
    .limit(15);
  // Each note travels with the bullets Lookout showed on that find, so the model can tell when a note is correcting one.
  const notes = noted.map(
    (n) =>
      `Find: "${n.title}" at ${n.company}\nLookout said: ${[...n.ok.map((r) => "+ " + r), ...n.gap.map((r) => "- " + r)].join(" | ") || "(no bullets)"}\nTheir note: ${n.notes.trim().slice(0, 400)}`,
  );
  const brief = kind.brief(answers);
  // nosemgrep: javascript.lang.security.audit.node-sha1.node_sha1 -- SHA-1 here only detects changed inputs, not security
  const hash = createHash("sha1").update(JSON.stringify([VERSION, brief, resumeText, linkedin, links, notes])).digest("hex");
  const answered = Object.values(answers).filter((v) => (Array.isArray(v) ? v.length : String(v ?? "").trim())).length;
  return {
    answers,
    brief,
    resume: resumeText,
    linkedin,
    links,
    notes,
    sources: { answers: answered, resume: !!resumeText, linkedin: !!linkedin, links: links.length, notes: notes.length },
    hash,
    stored: p,
  };
}

const Shape = z.object({
  summary: z.string().describe("Two or three plain sentences addressed to the person as 'you': who you are professionally and what you're after next"),
  targetTitles: z.array(z.string()).describe("3 to 8 job titles to search for, most likely first, including close variants"),
  seniority: z.string().describe("The level to aim for, e.g. 'Director to VP'"),
  industries: z.array(z.string()).describe("Industries or kinds of company that fit, up to 6"),
  strengths: z.array(z.string()).describe("4 to 8 short skills or areas of experience employers would screen for"),
  proof: z.array(z.string()).describe("2 to 4 concrete results from their history, with numbers when given"),
  where: z.string().describe("Locations and work modes, e.g. 'New York; hybrid or remote'"),
  pay: z.string().describe("Pay floor and target in plain words, or 'Not given'"),
  avoid: z.array(z.string()).describe("Things to rule out: their stated dealbreakers plus clear mismatches"),
  searchTerms: z.array(z.string()).describe("4 to 10 keywords that should appear in good postings"),
  corrections: z
    .array(z.string())
    .describe(
      "From their notes on finds, only feedback about how Lookout reads them or what it shows: a bullet that's wrong, a wrong assumption about their background, more or less of something. Write each as a plain fact about them, e.g. 'Has 5 years in banking and commercial digital; banking is not new to them'. Ignore notes that are their own thoughts on a job, to-dos, contacts or anything else. Empty if none.",
    ),
});

/** Render for prompts. */
export function renderSearchProfile(s: SearchProfile) {
  return [
    s.summary,
    `Target titles: ${s.targetTitles.join("; ")}`,
    `Level: ${s.seniority}`,
    `Industries: ${s.industries.join("; ") || "open"}`,
    `Strengths: ${s.strengths.join("; ")}`,
    `Proof: ${s.proof.join(" | ")}`,
    `Where: ${s.where}`,
    `Pay: ${s.pay}`,
    `Avoid: ${s.avoid.join("; ") || "nothing stated"}`,
    `Search terms: ${s.searchTerms.join(", ")}`,
    ...(s.corrections?.length ? [`Corrections from them (these override anything above or in earlier scores): ${s.corrections.join("; ")}`] : []),
  ].join("\n");
}

/** Whether a model is set up to build one (agent mode and missing models can't). */
export async function canBuild() {
  const ai = await getAiConfig();
  return ai.provider !== "agent" && !!ai.model;
}

/**
 * Return the user's search profile, rebuilding it first when its inputs changed
 * (or when forced). On failure, falls back to whatever is stored.
 */
export async function ensureSearchProfile(userId: string, usage: Usage, opts: { force?: boolean; build?: boolean } = {}) {
  const raw = await loadRawInputs(userId);
  const stored = raw.stored;
  const fresh = !!stored?.searchProfile && stored.searchProfileHash === raw.hash;
  if (fresh && !opts.force) return { profile: stored!.searchProfile!, rebuilt: false, raw };
  if (!raw.sources.answers && !raw.sources.resume && !raw.sources.linkedin) return { profile: null, rebuilt: false, raw };
  if (opts.build === false || !(await canBuild())) return { profile: stored?.searchProfile ?? null, rebuilt: false, raw };
  try {
    const out = await completeJSON({
      name: "search_profile",
      schema: Shape,
      usage,
      maxTokens: 1500,
      system:
        "You turn a job seeker's answers and background into a compact search profile. Their own answers outrank anything inferred from the resume. Only use facts given; never invent employers, numbers or credentials. Their notes on finds are mostly private jottings; use a note only when it is feedback about how Lookout read them, and then let it override the resume and the rest of the profile.",
      user: `<answers>\n${raw.brief}\n</answers>\n<resume>\n${raw.resume || "(none)"}\n</resume>` +
        (raw.linkedin ? `\n<linkedin_profile>\n${raw.linkedin}\n</linkedin_profile>` : "") +
        (raw.links.length ? `\n<their_links>\n${raw.links.map((l) => `${l.url}\n${l.text}`).join("\n---\n")}\n</their_links>` : "") +
        notesBlock(raw.notes),
    });
    const profile: SearchProfile = {
      ...out,
      targetTitles: out.targetTitles.slice(0, 8),
      industries: out.industries.slice(0, 6),
      strengths: out.strengths.slice(0, 8),
      proof: out.proof.slice(0, 4),
      avoid: out.avoid.slice(0, 8),
      searchTerms: out.searchTerms.slice(0, 10),
      corrections: out.corrections.slice(0, 8),
    };
    const at = new Date();
    if (stored) {
      await db.update(schema.profiles).set({ searchProfile: profile, searchProfileAt: at, searchProfileHash: raw.hash }).where(eq(schema.profiles.userId, userId));
    } else {
      await db.insert(schema.profiles).values({ userId, searchProfile: profile, searchProfileAt: at, searchProfileHash: raw.hash });
    }
    return { profile, rebuilt: true, raw };
  } catch (e) {
    if (e instanceof AiConfigError) return { profile: stored?.searchProfile ?? null, rebuilt: false, raw };
    console.error("[search-profile] build failed", e instanceof Error ? e.message : e);
    return { profile: stored?.searchProfile ?? null, rebuilt: false, raw, error: "Couldn't update it just now" };
  }
}
