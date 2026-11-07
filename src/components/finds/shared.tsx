"use client";

import type { KindConfig } from "@/lib/kinds";

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
const ON = { bg: "#99220F", ink: "#fff", border: "#99220F" };
const OFF = { bg: "#fff", ink: "#1D1A0F", border: "#E0D9CF" };
export const chip = (on: boolean) => (on ? ON : OFF);
export const seg = (on: boolean) => (on ? { bg: "#fff", ink: "#1D1A0F", shadow: "0 1px 3px rgba(29,26,15,.12)" } : { bg: "transparent", ink: "#6B6358", shadow: "none" });
