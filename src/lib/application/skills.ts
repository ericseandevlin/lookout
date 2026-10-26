import type { SkillNote } from "@/lib/db/schema";

/**
 * Experience notes (#121): skills the person says they have, with what backs them. Resumes are cut
 * to fit a page; these hold what got cut, so drafts can build around skills, not just titles.
 */

export function upsertNote(list: SkillNote[], skill: string, story: string): SkillNote[] {
  const key = skill.trim().toLowerCase();
  const rest = list.filter((n) => n.skill.toLowerCase() !== key);
  return [...rest, { skill: skill.trim(), story: story.trim(), updatedAt: new Date().toISOString() }].sort((a, b) => a.skill.localeCompare(b.skill));
}

export const removeNote = (list: SkillNote[], skill: string) => list.filter((n) => n.skill.toLowerCase() !== skill.trim().toLowerCase());

/** For prompts: the person's own words, with the same standing as their resume. */
export const notesBlock = (list: SkillNote[]) =>
  list.length
    ? `\n\n<experience_notes from the person; facts with the same standing as the resume>\n${list.map((n) => `- ${n.skill}${n.story ? `: ${n.story}` : " (they say they have this; no details given)"}`).join("\n")}\n</experience_notes>`
    : "";

export type KeywordChoices = { include: string[]; exclude: string[] };

/** Toggle one keyword's choice. "reset" clears it; including removes an exclude and the reverse. */
export function choose(c: KeywordChoices | undefined, term: string, action: "include" | "exclude" | "reset"): KeywordChoices {
  const t = term.trim();
  const drop = (xs: string[]) => xs.filter((x) => x.toLowerCase() !== t.toLowerCase());
  const include = drop(c?.include ?? []);
  const exclude = drop(c?.exclude ?? []);
  if (action === "include") include.push(t);
  if (action === "exclude") exclude.push(t);
  return { include, exclude };
}
