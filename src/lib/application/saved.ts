import type { SavedAnswer } from "@/lib/db/schema";

/**
 * Answers worth keeping across applications (#108): facts about the person that most forms ask in
 * nearly the same words. Job-specific essays and salary are never saved; they change per role.
 */

// Short words need \b: "city" sits inside "ethnicity", which saved an ethnicity answer for the drafting model (#1059).
const COMMON =
  /authori[sz]ed to work|work authori[sz]ation|legally (authorized|eligible)|sponsor|\bvisa\b|\bzip\b|postal|state of residence|^state$|\bcity\b|address|phone|mobile|country|relocat|notice period|start date|earliest.*start|when can you start|previously (worked|employed)|ever (been )?employed by|criminal|background check|\bdrug|18 years|\bage of\b|security clearance|how did you hear|referr|pronoun|preferred (first )?name/i;
// Never kept: salary and essays change per role; commute and office questions depend on where each job is.
// "years of" is experience, not "18 years of age" (#1059).
const NEVER = /salary|compensation|pay|expected|why|describe|tell us|cover letter|portfolio|years of(?! age)|commut|in.?office|hybrid|remote|location (listed|of the)|this (role|position|location)/i;
// Voluntary self-identification is never kept or shown to a model, even when a form asks it as a plain question (#1059).
const EEO = /ethnic|\brace\b|racial|hispanic|latin[oax]|gender|\bsex\b|sexual orientation|transgender|veteran|disabilit|self[- ]identif/i;

// Questions about one employer: a No is true almost everywhere, but a Yes or a referrer's name is about that company only.
// \b: "referr" sits inside "preferred", which made every preferred name a referrer's (#1048).
const ONE_EMPLOYER = /previously (worked|employed)|ever (been )?employed by|worked (here|for us)|\breferr/i;
const START = /start date|earliest.*start|when can you start/i;
// A calendar date ("12/1", "2026-12-01", "Dec 1", "June 1st", "1st December", "January 2027") passes;
// "2 weeks after an offer" stays true (#1079).
// Whole month names only: "dec" must not match "decision". "May" alone is a verb too, so it needs a day or year beside it.
const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b\.?/i;
const DATE_FORMS = /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b|\b\d{4}-\d{2}-\d{2}\b|\bmay,?\s+(\d{1,2}|(19|20)\d{2})\b|\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?may\b|\b\d{1,2}(st|nd|rd|th)\b|\b(19|20)\d{2}\b/i;
const DATE = { test: (a: string) => MONTH.test(a) || DATE_FORMS.test(a) };

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
  return COMMON.test(question) && !NEVER.test(question) && !EEO.test(question) && answer.trim().length > 0 && answer.length <= 300 && !onlyThisOne(question, answer);
}

export function upsert(list: SavedAnswer[], question: string, answer: string): SavedAnswer[] {
  const key = answerKey(question);
  const rest = list.filter((s) => s.key !== key);
  return [...rest, { key, question: question.trim(), answer: answer.trim(), updatedAt: new Date().toISOString() }].sort((a, b) => a.question.localeCompare(b.question));
}

/** A saved answer for the same question, if it fits the form's choices. */
export function match(list: SavedAnswer[], question: string, options?: string[] | null): string | null {
  // Answers saved before #1032 may still hold one employer's Yes: never reuse those.
  const hit = list.find((s) => s.key === answerKey(question) && !onlyThisOne(s.question, s.answer) && !EEO.test(s.question));
  if (!hit) return null;
  if (!options?.length) return hit.answer;
  return options.find((o) => o.toLowerCase() === hit.answer.toLowerCase()) ?? null;
}

/** For the drafting prompt: the model may reuse these when a question means the same thing. */
export const savedBlock = (all: SavedAnswer[]) => {
  // An EEO answer saved before #1059 never reaches the model.
  const list = all.filter((s) => !onlyThisOne(s.question, s.answer) && !EEO.test(s.question));
  return list.length ? `\n\n<saved_answers from the person's earlier applications; reuse when a question asks the same thing, source "saved answer">\n${list.map((s) => `- ${s.question}: ${s.answer}`).join("\n")}\n</saved_answers>` : "";
};
