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
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
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
});

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
});

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
    extracted: jsonb("extracted").$type<{ text?: string; summary?: string }>(),
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

export const STAGES = ["Not applied", "Applied", "Interview", "Offer", "Closed", "Ghosted", "Not selected"] as const;
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
    seenAt: timestamp("seen_at", { withTimezone: true }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    addedVia: text("added_via").$type<"agent" | "manual" | "import">().notNull().default("agent"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.opportunityId] })],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<"scheduled" | "manual" | "url" | "resume">().notNull(),
    status: text("status").$type<"running" | "done" | "failed">().notNull().default("running"),
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
