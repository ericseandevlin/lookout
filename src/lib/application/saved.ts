import type { SavedAnswer } from "@/lib/db/schema";

/**
 * Answers worth keeping across applications (#108): facts about the person that most forms ask in
 * nearly the same words. Job-specific essays and salary are never saved; they change per role.
 */

const COMMON =
  /authori[sz]ed to work|work authori[sz]ation|legally (authorized|eligible)|sponsor|visa|zip|postal|state of residence|^state$|city|address|phone|mobile|country|relocat|notice period|start date|earliest.*start|when can you start|commut|in.?office|hybrid|remote|previously (worked|employed)|ever (been )?employed by|criminal|background check|drug|18 years|age of|security clearance|how did you hear|referr|pronoun|preferred name/i;
const NEVER = /salary|compensation|pay|expected|why|describe|tell us|cover letter|portfolio|years of/i;

export const answerKey = (q: string) =>
  q
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Is this question one we should remember the answer to? */
export function isCommon(question: string, answer: string) {
  return COMMON.test(question) && !NEVER.test(question) && answer.trim().length > 0 && answer.length <= 300;
}

export function upsert(list: SavedAnswer[], question: string, answer: string): SavedAnswer[] {
  const key = answerKey(question);
  const rest = list.filter((s) => s.key !== key);
  return [...rest, { key, question: question.trim(), answer: answer.trim(), updatedAt: new Date().toISOString() }].sort((a, b) => a.question.localeCompare(b.question));
}

/** A saved answer for the same question, if it fits the form's choices. */
export function match(list: SavedAnswer[], question: string, options?: string[] | null): string | null {
  const hit = list.find((s) => s.key === answerKey(question));
  if (!hit) return null;
  if (!options?.length) return hit.answer;
  return options.find((o) => o.toLowerCase() === hit.answer.toLowerCase()) ?? null;
}

/** For the drafting prompt: the model may reuse these when a question means the same thing. */
export const savedBlock = (list: SavedAnswer[]) =>
  list.length ? `\n\n<saved_answers from the person's earlier applications; reuse when a question asks the same thing, source "saved answer">\n${list.map((s) => `- ${s.question}: ${s.answer}`).join("\n")}\n</saved_answers>` : "";
