// Shapes shared by the API and the client.
import type { ApplicationStatus, Density, Freq, RunReport, SetupMode, Stage } from "@/lib/db/schema";

export type { Density, Freq, SetupMode, Stage };

export type Find = {
  id: string;
  company: string;
  role: string;
  location: string;
  comp: [number, number] | null;
  postedAt: string | null;
  url: string | null;
  score: number;
  reasonsMatch: string[];
  reasonsGap: string[];
  stage: Stage;
  pinned: boolean;
  archived: boolean;
  notes: string;
  /** "Not a fit" reason the user gave, if any. */
  feedback: string | null;
  /** Auto-apply status for this role, when it's been queued. */
  application: { id: string; status: ApplicationStatus; queuedBy: "user" | "auto" } | null;
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

export type AppState = {
  user: { name: string; email: string; isAdmin: boolean; autoApply: boolean };
  settings: Settings;
  profile: { answers: Answers; auto: Record<string, string>; savedAt: string | null };
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
