import type { PersonalStory } from "@/lib/db/schema";
import type { Drafted } from "./draft";

/**
 * Personal connection stories (#155): moments from the person's life that tie them to what a company
 * makes or stands for. A cover letter opens with one true line from one of these. Real stories only:
 * Lookout never writes a personal memory the person didn't give it.
 */

export const STORY_THEMES = ["health", "education", "finance", "accessibility", "entertainment", "family", "community", "work", "other"] as const;
export type StoryTheme = (typeof STORY_THEMES)[number];

/** Questions that draw real stories out. Shown on the profile as starting points. */
export const STORY_PROMPTS = [
  "When did a company's product or mission touch your life, or someone close to you?",
  "What cause do you care about, and what got you there?",
  "What experience shaped how you work today?",
  "What product do you love, and why?",
];

export function upsertStory(list: PersonalStory[], s: { id?: string; theme: StoryTheme; story: string }): PersonalStory[] {
  const id = s.id ?? crypto.randomUUID();
  const next = { id, theme: s.theme, story: s.story.trim(), updatedAt: new Date().toISOString() };
  return list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? next : x)) : [...list, next];
}

export const removeStory = (list: PersonalStory[], id: string) => list.filter((s) => s.id !== id);

/** For prompts: each story with its id, so the model can say which one it used. */
export const storiesBlock = (list: PersonalStory[]) =>
  list.length
    ? `\n\n<personal_stories from the person, true and in their own words; cite one by id>\n${list.map((s) => `- [${s.id}] (${s.theme}) ${s.story}`).join("\n")}\n</personal_stories>`
    : "";

/**
 * The cover letter's personal line, checked in code: it must come from a saved story, or Lookout asks
 * for one. The ask goes in the note, not the item's question: answering a question replaces the item's
 * text, and one sentence must not replace the whole letter.
 */
export function checkStory(d: Drafted, a: { storyId?: string; storyAsk?: string } | undefined, stories: PersonalStory[], company: string): Drafted {
  const id = a?.storyId?.trim();
  const ask = a?.storyAsk?.trim();
  if (!d.content.trim()) return d;
  const used = id ? stories.find((s) => s.id === id) : undefined;
  if (used) {
    const short = used.story.length > 80 ? `${used.story.slice(0, 77)}...` : used.story;
    return { ...d, note: [d.note, `Opens with your story: "${short}"`].filter(Boolean).join(" "), sources: [...d.sources, `your story (${used.theme})`] };
  }
  if (id)
    return { ...d, question: "The opening line points to a personal story you never gave Lookout. Rewrite it from one of your stories, or cut it." };
  const q = ask || `Has ${company}'s work, or what it stands for, touched your life?`;
  return {
    ...d,
    note: [d.note, `None of your stories fits ${company}, so the letter has no personal line. ${q} If so, add it under Personal stories on your profile and redraft the letter.`].filter(Boolean).join(" "),
  };
}
