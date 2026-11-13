// Shapes shared by the API and the client.
import type { SubmitMode } from "@/lib/application/submitMode";
import type { ApplicationStatus, Density, Freq, RunReport, SetupMode, Stage } from "@/lib/db/schema";

export type { Density, Freq, SetupMode, Stage };

export type Find = {
  id: string;
  /** Which kind of find this is (#8); keys into the kind configs. */
  type: string;
  company: string;
  role: string;
  location: string;
  comp: [number, number] | null;
  /** Currency of the posted range. */
  currency: string;
  postedAt: string | null;
  /** Type-specific fields (#8): rfp carries agency, due date, value, set-aside. */
  attributes: Record<string, unknown>;
  url: string | null;
  score: number;
  reasonsMatch: string[];
  reasonsGap: string[];
  /** Any of its kind's stages (#8), not just the job stages. */
  stage: string;
  pinned: boolean;
  archived: boolean;
  notes: string;
  /** "Not a fit" reason the user gave, if any. */
  feedback: string | null;
  /** Auto-apply status for this role, when it's been queued. */
  application: { id: string; status: ApplicationStatus; queuedBy: "user" | "auto" } | null;
  /** Whether Lookout would press Submit or the person does (#187), from the read form or the posting URL. */
  submit: SubmitMode;
  seen: boolean;
  addedAt: string;
};

export type Resume = { id: string; name: string; status: "scanning" | "done" | "failed"; uploadedAt: string; filled: string };
export type Link = { id: string; url: string; kind: string | null; status: "scanning" | "done" | "failed" | null; note: string | null };

export type Settings = {
  freq: Freq;
  day: string;
  days: string[];
  digest: boolean;
  density: Density;
  setup: SetupMode;
  newDays: number;
  railClosed: boolean;
};

export type Answers = Record<string, string | string[]>;

/** One of an account's searches, for the switcher (#8). */
export type SearchInfo = { id: string; name: string; kind: string };

export type AppState = {
  user: { name: string; email: string; joinedAt: string; isAdmin: boolean; autoApply: boolean; events: boolean; searches: boolean };
  settings: Settings;
  /** Every search the account holds; the board, profile and runs follow `searchId` (#8). */
  searches: SearchInfo[];
  searchId: string;
  /** Whether this search has a discovery source on (#272: rfp needs a SAM.gov key). */
  canSearch?: boolean;
  profile: { kind: string; answers: Answers; auto: Record<string, string>; savedAt: string | null };
  materials: { resume: Resume | null; linkedin: { handle: string; linked: boolean; pdf: { name: string; uploadedAt: string } | null }; links: Link[] };
  finds: Find[];
  lastRunAt: string | null;
  /** The newest finished search that has a report, kept on the board after the panel goes away. */
  lastReport: { at: string; added: number; report: RunReport } | null;
  running: string | null;
  run: RunInfo | null;
};

export type RunInfo = {
  id: string;
  trigger: string;
  status: "queued" | "running" | "done" | "failed";
  pct: number;
  step: string;
  log: { at: string; text: string }[];
  found: number;
  added: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  report: RunReport | null;
};
