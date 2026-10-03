// Shapes shared by the API and the client.
import type { Density, Freq, SetupMode, Stage } from "@/lib/db/schema";

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
  seen: boolean;
  addedAt: string;
};

export type Resume = { id: string; name: string; status: "scanning" | "done" | "failed"; uploadedAt: string; filled: string };
export type Link = { id: string; url: string; kind: string | null };

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
  user: { name: string; email: string; isAdmin: boolean };
  settings: Settings;
  profile: { answers: Answers; auto: Record<string, string>; savedAt: string | null };
  materials: { resume: Resume | null; linkedin: { handle: string; linked: boolean }; links: Link[] };
  finds: Find[];
  lastRunAt: string | null;
  running: string | null;
};
