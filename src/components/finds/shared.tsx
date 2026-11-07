"use client";

import type { KindConfig } from "@/lib/kinds";
import { color } from "@/lib/tokens";

/** Shared by the board and its filter sheet: sort keys and the chip and segment styles. */

export type SortKey = "score" | "company" | "role" | "comp" | "listed" | "stage" | "location" | "value" | "due" | "setAside";

const SORT_LABELS: Record<SortKey, string> = {
  score: "Match", company: "Company", role: "Role", comp: "Comp", listed: "Posted",
  stage: "Stage", location: "Location", value: "Value", due: "Due", setAside: "Set-aside",
};

/** Sort choices for one kind's board: Match, then its columns, then Stage (#8). */
export const sortsFor = (cfg: KindConfig): [SortKey, string][] => {
  const keys: SortKey[] = ["score", ...cfg.board.columns.map((c) => c.key as SortKey), cfg.board.preStage.key as SortKey, "stage", cfg.board.tail.key as SortKey];
  return keys.map((k) => [k, SORT_LABELS[k]]);
};
const ON = { bg: color.brick, ink: "#fff", border: color.brick };
const OFF = { bg: "#fff", ink: color.ink, border: "#E0D9CF" };
export const chip = (on: boolean) => (on ? ON : OFF);
export const seg = (on: boolean) => (on ? { bg: "#fff", ink: color.ink, shadow: "0 1px 3px rgba(29,26,15,.12)" } : { bg: "transparent", ink: color.t2, shadow: "none" });
