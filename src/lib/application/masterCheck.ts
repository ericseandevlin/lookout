import { humanize } from "./resumeLayout";
import { looseDates } from "./masterDates";

/**
 * Code-held checks on the master resume rebuild (#131). The model decides where each bullet goes;
 * this checks that against the file itself, so a misplaced bullet can't reach a draft.
 */
export function finishMaster(md: string, source: string): { md: string; uncertain: string[] } {
  return { md: humanize(md.trim()), uncertain: looseDates(md, source) };
}
