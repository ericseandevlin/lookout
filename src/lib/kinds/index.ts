/**
 * Opportunity type config (#8). Every type-specific piece (profile questions, copy,
 * board columns, stages, the discovery brief) lives here so new kinds are added as
 * new configs. Jobs are the first kind; `rfp` is the second. A kind without
 * `discovery` is set up end to end but has no search sources yet.
 */
/** A kind's config, or the job kind when the id isn't one (the default). */
export const kindOf = (id: string | null | undefined) => kinds[id ?? "job"] ?? kinds.job;
export type Question =
  | {
      key: string;
      kind: "text";
      prompt: string;
      helper: string;
      placeholder: string;
      /**
       * Quick picks. "insert" opens a sentence starter with inline blanks (see lib/blanks); "toggle" adds or removes an item in a
       * comma list; "append" adds or removes a phrase at the end of free text without touching the rest.
       */
      starters?: { mode: "insert" | "toggle" | "append"; options: { label: string; text: string }[] };
    }
  | { key: string; kind: "comp"; prompt: string; helper: string; floorKey: string; targetKey: string }
  | { key: string; kind: "modes"; prompt: string; modesKey: string; areaKey: string; options: string[] };

/** Board column keys. "company"/"role"/"comp"/"listed"/"location" are Find fields; the rest come from the find's attributes (#8). */
export type ColumnKey = "company" | "role" | "comp" | "listed" | "location" | "value" | "due" | "setAside";

export type KindBoard = {
  /** Columns between Match and Stage. Exactly three today. */
  columns: { key: ColumnKey; label: string }[];
  /** The column right before Stage (job: Posted; rfp: Due). */
  preStage: { key: ColumnKey; label: string };
  /** The column after Stage (job: Location; rfp: Set-aside). */
  tail: { key: ColumnKey; label: string };
};

export type KindConfig = {
  id: string;
  noun: { one: string; many: string };
  questions: Question[];
  /** Turns profile answers into a plain brief for the discovery agent. */
  brief: (a: Record<string, string | string[]>) => string;
  /** Stages a find moves through, in board order. */
  stages: string[];
  /** Stages that end a find: moving into one archives it (#180). */
  endedStages: string[];
  /** Stage new finds start at. */
  defaultStage: string;
  /** Board columns for this kind (#8). */
  board: KindBoard;
  /** Whether the discovery pipeline can search for this kind yet. */
  discovery: boolean;
};

/** Answer key for the optional free-text "Bonus context" field under the five questions. It doesn't count toward "answered". */
export const BONUS_KEY = "bonus";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const job: KindConfig = {
  id: "job",
  noun: { one: "role", many: "roles" },
  questions: [
    {
      key: "q1",
      kind: "text",
      prompt: "What's the next role, and what would make it a real step up?",
      helper: "Title, scope, team size, the kind of venue or company.",
      placeholder: "e.g. Director of Events at a flagship venue, owning sales and production",
      starters: {
        mode: "append",
        options: [
          { label: "Bigger title", text: "a bigger title" },
          { label: "Larger team", text: "leading a larger team" },
          { label: "Own the strategy", text: "owning the strategy, not just executing it" },
          { label: "P&L or budget", text: "owning a P&L or budget" },
          { label: "More pay", text: "a real jump in pay" },
          { label: "Stronger brand", text: "a stronger company or brand" },
          { label: "Broader scope", text: "a broader scope across more of the business" },
          { label: "New industry", text: "moving into a new industry" },
        ],
      },
    },
    {
      key: "comp",
      kind: "comp",
      prompt: "What comp would you walk away from, and what would make you jump?",
      helper: "Base salary. Roles below your floor get marked down, not hidden.",
      floorKey: "floor",
      targetKey: "target",
    },
    {
      key: "where",
      kind: "modes",
      prompt: "Where and how do you want to work?",
      modesKey: "modes",
      areaKey: "area",
      options: ["On-site", "Hybrid", "Remote"],
    },
    {
      key: "q4",
      kind: "text",
      prompt: "What's the win you'd lead with in an interview?",
      helper: "One result from the last few years, with a number if you have one.",
      placeholder: "e.g. Rebuilt the banquet sales team and grew private-event revenue 40% in two years",
      starters: {
        mode: "insert",
        options: [
          { label: "Grew revenue", text: "Grew revenue {n:40}%[ in {n:2} years][ by {t:rebuilding the sales team}]" },
          { label: "Cut costs", text: "Cut costs by ${s:200k} a year[ by {t:renegotiating vendor contracts}]" },
          { label: "Launched something", text: "Launched {s:a new booking app}[, which reached {s:10,000 users}]" },
          { label: "Built a team", text: "Built and led a team of {n:8}[ that {t:shipped the new design system}]" },
          { label: "Turned it around", text: "Took {s:the venue} from {s:a loss} to {s:a profit}[ by {t:cutting slow menus}]" },
          { label: "Landed a big client", text: "Won {s:a national hotel group}[, a ${s:2M} account,][ by {t:pitching a custom package}]" },
        ],
      },
    },
    {
      key: "q5",
      kind: "text",
      prompt: "What's off the table?",
      helper: "Companies, schedules, cultures or travel you'd rule out.",
      placeholder: "e.g. No overnight shifts, no more than 20% travel",
      starters: {
        mode: "toggle",
        options: [
          { label: "Relocating", text: "No relocation" },
          { label: "Lots of travel", text: "No more than 20% travel" },
          { label: "Fully on-site", text: "Not fully on-site" },
          { label: "Early startups", text: "No early-stage startups" },
          { label: "Agencies", text: "No agencies" },
          { label: "Contract roles", text: "No contract roles" },
          { label: "Commission pay", text: "No commission-heavy pay" },
          { label: "Nights and weekends", text: "No nights or weekends" },
        ],
      },
    },
  ],
  brief: (a) =>
    [
      `Next role they want: ${str(a.q1) || "(not given)"}`,
      `Comp floor (base): ${str(a.floor) || "(not given)"}; would jump for: ${str(a.target) || "(not given)"}`,
      `Work modes: ${arr(a.modes).join(", ") || "(any)"}; areas: ${str(a.area) || "(not given)"}`,
      `Win they lead with: ${str(a.q4) || "(not given)"}`,
      `Dealbreakers: ${str(a.q5) || "(none given)"}`,
      // Optional, so it's left out when empty and existing briefs (and their cache hash) stay the same.
      ...(str(a[BONUS_KEY]) ? [`Other context from them: ${str(a[BONUS_KEY])}`] : []),
    ].join("\n"),
  stages: ["Not applied", "Auto-applying", "Applied", "Interview", "Offer", "Closed", "Ghosted", "Not selected", "Nope"],
  endedStages: ["Closed", "Ghosted", "Not selected", "Nope"],
  defaultStage: "Not applied",
  board: {
    columns: [
      { key: "company", label: "Company" },
      { key: "role", label: "Role" },
      { key: "comp", label: "Comp" },
    ],
    preStage: { key: "listed", label: "Posted" },
    tail: { key: "location", label: "Location" },
  },
  discovery: true,
};

export const rfp: KindConfig = {
  id: "rfp",
  noun: { one: "opportunity", many: "opportunities" },
  questions: [
    {
      key: "q1",
      kind: "text",
      prompt: "What work can your business do, and what would make a contract a real win?",
      helper: "Services, clients, the kind of agency or team you want to grow into.",
      placeholder: "e.g. Event production for city and federal agencies, growing into multi-year contracts",
      starters: {
        mode: "append",
        options: [
          { label: "Bigger contracts", text: "larger contract values" },
          { label: "Multi-year", text: "multi-year contracts" },
          { label: "Prime, not sub", text: "prime contracts, not subcontracting" },
          { label: "New agencies", text: "new agencies or markets" },
          { label: "Recurring work", text: "recurring or standing work" },
        ],
      },
    },
    {
      key: "naics",
      kind: "text",
      prompt: "What NAICS codes describe your work?",
      helper: "The codes agencies search by. Look them up once; they apply to every solicitation.",
      placeholder: "e.g. 561920, 711310, 561910",
    },
    {
      key: "certs",
      kind: "text",
      prompt: "What certifications or set-asides does your business hold?",
      helper: "Certifications that qualify you for set-aside contracts.",
      placeholder: "e.g. 8(a), WOSB",
      starters: {
        mode: "toggle",
        options: [
          { label: "8(a)", text: "8(a)" },
          { label: "WOSB", text: "WOSB" },
          { label: "SDVOSB", text: "SDVOSB" },
          { label: "HUBZone", text: "HUBZone" },
          { label: "Small business", text: "Small business" },
        ],
      },
    },
    {
      key: "comp",
      kind: "comp",
      prompt: "What contract value is too small, and what would you jump for?",
      helper: "Annual contract value. Solicitations below your floor get marked down, not hidden.",
      floorKey: "floor",
      targetKey: "target",
    },
    {
      key: "geo",
      kind: "text",
      prompt: "Where can you perform the work?",
      helper: "States, cities or regions you can serve, or a delivery radius.",
      placeholder: "e.g. New York City metro, plus remote work nationwide",
      starters: {
        mode: "toggle",
        options: [
          { label: "Nationwide", text: "Nationwide" },
          { label: "Northeast", text: "Northeast" },
          { label: "My metro only", text: "My metro area only" },
        ],
      },
    },
  ],
  brief: (a) =>
    [
      `Work the business wants: ${str(a.q1) || "(not given)"}`,
      `NAICS codes: ${str(a.naics) || "(not given)"}`,
      `Certifications / set-asides: ${str(a.certs) || "(none given)"}`,
      `Contract value floor: ${str(a.floor) || "(not given)"}; would jump for: ${str(a.target) || "(not given)"}`,
      `Geographies they can serve: ${str(a.geo) || "(not given)"}`,
    ].join("\n"),
  stages: ["Reviewing", "Bid", "Submitted", "Awarded", "Lost"],
  endedStages: ["Lost"],
  defaultStage: "Reviewing",
  board: {
    columns: [
      { key: "company", label: "Agency" },
      { key: "role", label: "Opportunity" },
      { key: "value", label: "Value" },
    ],
    preStage: { key: "due", label: "Due" },
    tail: { key: "setAside", label: "Set-aside" },
  },
  /** Web search is off for rfp: it reads SAM.gov's API instead, once SAM_API_KEY is set (#272, see src/lib/sources.ts). State and city portals come later. */
  discovery: false,
};

export const kinds: Record<string, KindConfig> = { job, rfp };

/** Count answered questions the same way the prototype does: a question counts once any of its fields is set. */
export function answeredCount(cfg: KindConfig, a: Record<string, string | string[]>) {
  return cfg.questions.filter((q) => {
    if (q.kind === "text") return !!str(a[q.key]);
    if (q.kind === "comp") return !!(str(a[q.floorKey]) || str(a[q.targetKey]));
    return arr(a[q.modesKey]).length > 0 || !!str(a[q.areaKey]);
  }).length;
}

const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** "$120,000" / "120k" / "120000" -> 120000; "$2M" / "2 million" -> 2000000; "$1.2B" -> 1200000000 (#482) */
export function parseMoney(v: unknown): number | null {
  const s = str(v).toLowerCase().replace(/[,$\s]/g, "");
  if (!s) return null;
  const m = /^(\d+(?:\.\d+)?)(k|m|b)?/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]) * (m[2] ? SCALE[m[2]] : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
