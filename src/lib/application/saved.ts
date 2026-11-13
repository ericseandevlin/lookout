import type { SavedAnswer } from "@/lib/db/schema";

/**
 * Answers worth keeping across applications (#108): facts about the person that most forms ask in
 * nearly the same words. Job-specific essays and salary are never saved; they change per role.
 */

const COMMON =
  /authori[sz]ed to work|work authori[sz]ation|legally (authorized|eligible)|sponsor|visa|zip|postal|state of residence|^state$|city|address|phone|mobile|country|relocat|notice period|start date|earliest.*start|when can you start|previously (worked|employed)|ever (been )?employed by|criminal|background check|drug|18 years|age of|security clearance|how did you hear|referr|pronoun|preferred (first )?name/i;
// Never kept: salary and essays change per role; commute and office questions depend on where each job is.
const NEVER = /salary|compensation|pay|expected|why|describe|tell us|cover letter|portfolio|years of|commut|in.?office|hybrid|remote|location (listed|of the)|this (role|position|location)/i;

// Questions about one employer: a No is true almost everywhere, but a Yes or a referrer's name is about that company only.
// \b: "referr" sits inside "preferred", which made every preferred name a referrer's (#1048).
const ONE_EMPLOYER = /previously (worked|employed)|ever (been )?employed by|worked (here|for us)|\breferr/i;
const START = /start date|earliest.*start|when can you start/i;
// A calendar date ("12/1", "2026-12-01", "Dec 1") passes; "2 weeks after an offer" stays true.
const DATE = /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\bmay \d{1,2}\b/i;

/** An answer that fits only the application it was given on, so it must not travel to the next one (#1032). */
export const onlyThisOne = (question: string, answer: string) =>
  (ONE_EMPLOYER.test(question) && !/^no\b/i.test(answer.trim())) || (START.test(question) && DATE.test(answer));

export const answerKey = (q: string) =>
  q
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Is this question one we should remember the answer to? */
export function isCommon(question: string, answer: string) {
  return COMMON.test(question) && !NEVER.test(question) && answer.trim().length > 0 && answer.length <= 300 && !onlyThisOne(question, answer);
}

export function upsert(list: SavedAnswer[], question: string, answer: string): SavedAnswer[] {
  const key = answerKey(question);
  const rest = list.filter((s) => s.key !== key);
  return [...rest, { key, question: question.trim(), answer: answer.trim(), updatedAt: new Date().toISOString() }].sort((a, b) => a.question.localeCompare(b.question));
}

/** A saved answer for the same question, if it fits the form's choices. */
export function match(list: SavedAnswer[], question: string, options?: string[] | null): string | null {
  // Answers saved before #1032 may still hold one employer's Yes: never reuse those.
  const hit = list.find((s) => s.key === answerKey(question) && !onlyThisOne(s.question, s.answer));
  if (!hit) return null;
  if (!options?.length) return hit.answer;
  return options.find((o) => o.toLowerCase() === hit.answer.toLowerCase()) ?? null;
}

/** For the drafting prompt: the model may reuse these when a question means the same thing. */
export const savedBlock = (all: SavedAnswer[]) => {
  const list = all.filter((s) => !onlyThisOne(s.question, s.answer));
  return list.length ? `\n\n<saved_answers from the person's earlier applications; reuse when a question asks the same thing, source "saved answer">\n${list.map((s) => `- ${s.question}: ${s.answer}`).join("\n")}\n</saved_answers>` : "";
};
