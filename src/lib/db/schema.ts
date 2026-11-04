import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    isAdmin: boolean("is_admin").notNull().default(false),
    disabled: boolean("disabled").notNull().default(false),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Set when the welcome step is done (name, salary range, work mode) */
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  /** "login" signs in; "email_change" moves userId's account to `email` */
  purpose: text("purpose").$type<"login" | "email_change">().notNull().default("login"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export type Freq = "Weekly" | "Twice a week" | "Daily";
export type Density = "Comfortable" | "Compact";
export type SetupMode = "Until complete" | "Always" | "Never";

export const settings = pgTable("settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  freq: text("freq").$type<Freq>().notNull().default("Weekly"),
  runDay: text("run_day").notNull().default("Mon"),
  runDays: text("run_days").array().notNull().default(sql`ARRAY['Mon','Thu']::text[]`),
  digest: boolean("digest").notNull().default(true),
  density: text("density").$type<Density>().notNull().default("Comfortable"),
  setupMode: text("setup_mode").$type<SetupMode>().notNull().default("Until complete"),
  newDays: integer("new_days").notNull().default(7),
  railClosed: boolean("rail_closed").notNull().default(false),
  /** Auto-apply beta: off by default. Threshold = lowest match score queued automatically; cap = per day. */
  autoApply: jsonb("auto_apply").$type<AutoApplySettings>().notNull().default({ enabled: false, threshold: 5, dailyCap: 3 }),
});

export type AutoApplySettings = { enabled: boolean; threshold: 4 | 5; dailyCap: number; /** Resume and cover letter design (#129). */ template?: "classic" | "modern" | "cool"; /** Cool's highlight color, hex without # (#137). */ accent?: string };

/** Answers to the opportunity type's profile questions. Keys come from the kind config. */
export type ProfileAnswers = Record<string, string | string[]>;

export const profiles = pgTable("profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("job"),
  answers: jsonb("answers").$type<ProfileAnswers>().notNull().default({}),
  /** field key -> source label ("resume", "LinkedIn") for answers filled automatically */
  autofilled: jsonb("autofilled").$type<Record<string, string>>().notNull().default({}),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /** What searches use: built by the model from answers + materials, shown to the user as "What Lookout sees". */
  searchProfile: jsonb("search_profile").$type<SearchProfile>(),
  searchProfileAt: timestamp("search_profile_at", { withTimezone: true }),
  /** Hash of the inputs it was built from; a mismatch means it's stale. */
  searchProfileHash: text("search_profile_hash"),
  /** Answers to questions most applications ask (work authorization, ZIP...), reused on the next one. Editable on the profile. */
  applyAnswers: jsonb("apply_answers").$type<SavedAnswer[]>().notNull().default([]),
  /** Skills the person says they have, with the experience behind them (#121). Editable on the profile. */
  skillNotes: jsonb("skill_notes").$type<SkillNote[]>().notNull().default([]),
  /** Voluntary EEO answers (#122), AES-GCM encrypted JSON (EeoProfile). Never sent to an AI model. */
  eeo: text("eeo"),
  /** The person allowed Lookout to fill EEO questions from those answers. Off by default. */
  eeoConsent: boolean("eeo_consent").notNull().default(false),
  /** The resume rebuilt once from the uploaded file into clean structure (#131); drafts start from this. */
  masterResume: jsonb("master_resume").$type<MasterResume>(),
});

export type SavedAnswer = { key: string; question: string; answer: string; updatedAt: string };

/** Experience the person added for a skill (#121): a role, project or result their resume doesn't show. Counts as a fact in every draft. */
/** fromHash: the extracted text it was built from (a new upload rebuilds it). edited: the person fixed it by hand. */
export type MasterResume = {
  /** The working copy: the latest rebuild or the person's latest edit. */
  md: string;
  fromHash: string;
  edited: boolean;
  at: string;
  /** What the rebuild wasn't sure about, for the person to check. */ uncertain?: string[];
  /** The version the person confirmed; drafts read this one, and a rebuild never touches it (#131). */
  confirmed?: { md: string; at: string; fromHash?: string };
};

export type SkillNote = { skill: string; story: string; updatedAt: string };

export type SearchProfile = {
  summary: string;
  targetTitles: string[];
  seniority: string;
  industries: string[];
  strengths: string[];
  proof: string[];
  where: string;
  pay: string;
  avoid: string[];
  searchTerms: string[];
  /** Feedback pulled from their notes on finds: where Lookout read them wrong. Other notes are ignored. */
  corrections?: string[];
};

export type MaterialKind = "resume" | "linkedin" | "link";

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<MaterialKind>().notNull(),
    url: text("url"),
    /** User override for the link label; null means auto-detect */
    linkKind: text("link_kind"),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    mime: text("mime"),
    status: text("status").$type<"scanning" | "done" | "failed">(),
    filledNote: text("filled_note"),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    extracted: jsonb("extracted").$type<{ text?: string; summary?: string; uploadedAt?: string }>(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("materials_user_idx").on(t.userId)],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull().default("job"),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    workMode: text("work_mode"),
    compMin: integer("comp_min"),
    compMax: integer("comp_max"),
    currency: text("currency").notNull().default("USD"),
    postedAt: date("posted_at"),
    sourceUrl: text("source_url"),
    description: text("description").notNull().default(""),
    /** Type-specific fields for non-job opportunity types */
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    fingerprint: text("fingerprint").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("opportunities_fingerprint_idx").on(t.fingerprint), index("opportunities_url_idx").on(t.sourceUrl)],
);

export const STAGES = ["Not applied", "Auto-applying", "Applied", "Interview", "Offer", "Closed", "Ghosted", "Not selected", "Nope"] as const;
export type Stage = (typeof STAGES)[number];

export const userOpportunities = pgTable(
  "user_opportunities",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    reasonsMatch: text("reasons_match").array().notNull().default(sql`ARRAY[]::text[]`),
    reasonsGap: text("reasons_gap").array().notNull().default(sql`ARRAY[]::text[]`),
    stage: text("stage").$type<Stage>().notNull().default("Not applied"),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    notes: text("notes").notNull().default(""),
    /** "Not a fit" from the user, fed back into later searches. */
    feedback: jsonb("feedback").$type<{ reason: string; at: string }>(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    addedVia: text("added_via").$type<"agent" | "manual" | "import">().notNull().default("agent"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.opportunityId] })],
);

export type RunProgress = { pct: number; step: string; log: { at: string; text: string }[] };
/** What happened to the postings a search read. Floor and location only mark a find down; the rest keep it off the board. */
export type RunTally = { postings: number; notPostings: number; known: number; dealbreaker: number; belowFloor: number; offLocation: number; added: number; closed?: number };
export type RunTip = { text: string; href?: string; label?: string };
/** The after-search report: the funnel, the queries used, and what to change. */
export type RunReport = { queries: string[]; results: number; picked: number; read: number; tally: RunTally; tips: RunTip[] };

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<"scheduled" | "manual" | "url" | "resume">().notNull(),
    status: text("status").$type<"queued" | "running" | "done" | "failed">().notNull().default("running"),
    /** Live progress for the UI: percent, current step, and a short log of steps */
    progress: jsonb("progress").$type<RunProgress>().notNull().default({ pct: 0, step: "", log: [] }),
    /** Input for runs handled by an external agent, e.g. the URL for a manual add */
    request: jsonb("request").$type<Record<string, unknown>>(),
    report: jsonb("report").$type<RunReport>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    found: integer("found").notNull().default(0),
    added: integer("added").notNull().default(0),
    error: text("error"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    searches: integer("searches").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
  },
  (t) => [index("runs_user_started_idx").on(t.userId, t.startedAt)],
);

/** Admin-editable app config (AI provider, search, sign-up mode, budgets). Secrets inside are encrypted. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Emails an admin has let in. In invite-only mode these may request sign-in links. */
export const invites = pgTable("invites", {
  email: text("email").primaryKey(),
  invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Request-access form submissions. Approving one creates an invite. */
export const accessRequests = pgTable("access_requests", {
  email: text("email").primaryKey(),
  /** Key of the "What's your next move?" choice; pre-fills profile question 1 */
  nextMove: text("next_move"),
  status: text("status").$type<"pending" | "approved" | "declined">().notNull().default("pending"),
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
});

// --- Auto-apply (beta). Spec: docs/auto-apply.md ---------------------------------

export const APPLICATION_STATUSES = ["queued", "scanning", "drafting", "needs_review", "approved", "submitting", "submitted", "manual", "failed", "canceled"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** One application to one find. Nothing is submitted until every required item has an approved version. */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    status: text("status").$type<ApplicationStatus>().notNull().default("queued"),
    /** How it was queued: the user clicked, or the auto-apply switch picked it. */
    queuedBy: text("queued_by").$type<"user" | "auto">().notNull().default("user"),
    /** Detected applicant tracking system, e.g. greenhouse, lever, ashby, workday. */
    ats: text("ats"),
    /** How it can be submitted: api, browser, or manual. */
    route: text("route").$type<"api" | "browser" | "manual">(),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** What came back after submitting: confirmation text, page URL or email subject. */
    confirmation: jsonb("confirmation").$type<Record<string, unknown>>(),
    /** How the application was read and drafted: where the form came from, keyword report, last error. */
    report: jsonb("report").$type<ApplicationReport>().notNull().default({}),
  },
  (t) => [uniqueIndex("applications_user_opp_idx").on(t.userId, t.opportunityId), index("applications_user_status_idx").on(t.userId, t.status)],
);

export type ApplicationReport = {
  /** "form": the ATS's published form. "page": read from the apply page by the model. */
  source?: "form" | "page";
  applyUrl?: string;
  /** The form has voluntary EEO questions. Lookout never answers those; the user does. */
  hasEeo?: boolean;
  /** No form found: how the posting says to apply. */
  howToApply?: string;
  scannedAt?: string;
  draftedAt?: string;
  error?: string;
  /** AI spend for this application, in USD. */
  usd?: number;
  /** Last browser fill: a test run or a real submit, what it filled and why it stopped. */
  fill?: { mode: "test" | "submit"; at: string; log: { prompt: string; ok: boolean; how: string }[]; missing: string[]; stopped?: string; captcha?: boolean; confirmation?: string; finalUrl?: string };
  /** Instructions planted in the posting to catch automated applications; cut from drafts, shown to the user (#116). */
  traps?: { text: string; words: string[]; hidden: boolean }[];
  /** The posting text the drafts were written from (shown beside them on the review screen). */
  postingText?: string;
  /** The user's keyword picks for this resume (#121): terms to work in, terms to leave out. */
  keywordChoices?: { include: string[]; exclude: string[] };
  /** Keywords proposed from the posting, with the experience line the model cited (checked in code before use) (#121). */
  keywordPlan?: { term: string; cite?: string }[];
  /** The person's one go for the final keyword list; any change to the list clears it (#121). */
  keywordsApproved?: { terms: string[]; at: string };
  /** Posting keywords and whether the master resume (before) and the ATS draft (after) carry them. */
  keywords?: { term: string; before: boolean; after: boolean; where?: string; choice?: "include" | "exclude" }[];
  /** The last Recruiter Analysis of each resume or cover letter item, by item id, for the version it read (#152). */
  recruiter?: Record<string, import("@/lib/application/recruiter").RecruiterAnalysis>;
};

export const APPLICATION_ITEM_KINDS = ["resume", "cover_letter", "answer", "portfolio", "outreach", "field", "eeo"] as const;
export type ApplicationItemKind = (typeof APPLICATION_ITEM_KINDS)[number];

/** Something the application asks for (or an outreach draft), each with its own versions. */
export const applicationItems = pgTable("application_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  kind: text("kind").$type<ApplicationItemKind>().notNull(),
  /** The question or field label as the application words it. */
  prompt: text("prompt").notNull(),
  required: boolean("required").notNull().default(false),
  position: integer("position").notNull().default(0),
  approvedVersionId: uuid("approved_version_id"),
  /** The form's field type (text, textarea, file, select, multiselect, checkbox). */
  fieldType: text("field_type"),
  /** Allowed answers for choice questions, as the form words them. */
  options: jsonb("options").$type<string[]>(),
  /** What Lookout needs from the user before it can answer this one. Empty once answered. */
  question: text("question"),
});

/** Every draft and edit, kept with a note about who changed what and why. */
export const itemVersions = pgTable(
  "item_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => applicationItems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull().default(""),
    fileKey: text("file_key"),
    note: text("note").notNull().default(""),
    author: text("author").$type<"user" | "ai">().notNull(),
    /** Where the facts in this draft came from (resume line, profile answer, posting). */
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("item_versions_item_version_idx").on(t.itemId, t.version)],
);

/** The chat-to-edit thread for one application. */
export const applicationMessages = pgTable("application_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  createdAt: createdAt(),
});


/** Fixed-window rate-limit counters (see src/lib/ratelimit.ts). Rows past expires_at no longer count and get swept. */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_expires_at_idx").on(t.expiresAt)],
);

/** Bearer tokens for the Firefox extension (#169). Stored hashed, like sessions; one active token per user. */
export const extensionTokens = pgTable(
  "extension_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("extension_tokens_user_idx").on(t.userId)],
);

export type InboundTriage = {
  kind: "recruiter" | "invitee" | "user" | "vendor" | "spam" | "other";
  summary: string;
  applicationId?: string | null;
  draftReply?: string | null;
  by: string;
};

/** Email received at lookout.ericdevlin.co through Resend (#178). Untrusted data: read and summarized, never obeyed. */
export const inboundEmails = pgTable(
  "inbound_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resendId: text("resend_id").notNull(),
    messageId: text("message_id"),
    fromAddr: text("from_addr").notNull(),
    fromHeader: text("from_header"),
    to: jsonb("to").$type<string[]>().notNull().default([]),
    subject: text("subject").notNull().default(""),
    text: text("text").notNull().default(""),
    inReplyTo: text("in_reply_to"),
    authentication: jsonb("authentication").$type<{ spf?: string; dkim?: string; dmarc?: string } | null>(),
    attachments: jsonb("attachments").$type<{ filename: string; contentType: string }[]>().notNull().default([]),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    status: text("status").$type<"new" | "triaged" | "ignored">().notNull().default("new"),
    triage: jsonb("triage").$type<InboundTriage | null>(),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inbound_emails_resend_idx").on(t.resendId), index("inbound_emails_status_idx").on(t.status, t.receivedAt)],
);

// --- One-question beta surveys (#5) ---------------------------------------------

export const SURVEY_KINDS = ["choice", "scale", "text"] as const;
export type SurveyKind = (typeof SURVEY_KINDS)[number];

/** A question Eric asks beta users, one at a time. Only active questions are shown. */
export const surveyQuestions = pgTable("survey_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<SurveyKind>().notNull(),
  prompt: text("prompt").notNull(),
  /** Choices for "choice"; empty otherwise. A scale is always 1-5. */
  options: jsonb("options").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** One person's reply to one question. Dismissing the dialog records a skip, so it isn't asked again. */
export const surveyAnswers = pgTable(
  "survey_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => surveyQuestions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null when skipped. */
    answer: text("answer"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("survey_answers_question_user_idx").on(t.questionId, t.userId), index("survey_answers_user_idx").on(t.userId, t.createdAt)],
);

// --- Digest email clicks (#34) ----------------------------------------------------

/** One digest email sent, for counting clicks against. */
export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The search that triggered it, when known. */
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    finds: integer("finds").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("digests_user_sent_idx").on(t.userId, t.sentAt)],
);

/** A link clicked in a digest: a find's posting, or the board (opportunityId null). Counted once per link (the board link is checked in code: Postgres treats nulls as distinct). */
export const digestClicks = pgTable(
  "digest_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    digestId: uuid("digest_id")
      .notNull()
      .references(() => digests.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("digest_clicks_once_idx").on(t.digestId, t.opportunityId)],
);

// --- First-party product events (#35) ---------------------------------------------

/** What people do in Lookout, written by the app itself. No third-party scripts. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** What it was about: a find id, a page path, a material kind. */
    target: text("target"),
    meta: jsonb("meta").$type<Record<string, string | number | boolean>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_user_at_idx").on(t.userId, t.at), index("events_type_at_idx").on(t.type, t.at)],
);
