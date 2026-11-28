import type { SavedAnswer } from "@/lib/db/schema";
import { sameOption } from "./fillPlan";

/**
 * Answers worth keeping across applications (#108): facts about the person that most forms ask in
 * nearly the same words. Job-specific essays and salary are never saved; they change per role.
 */

// "Are you 18 or older?" and "over 18" too (#1576). "Legally able", "eligible" and "right to work" are work authorization (#1597), and so is a work permit (#1619).
// Short words need \b: "city" sits inside "ethnicity", which saved an ethnicity answer for the drafting model (#1059).
const COMMON =
  /authori[sz]ed to work|work authori[sz]ation|legally (authorized|eligible|able|permitted)|(eligible|permitted) to work|right to work|work permit|sponsor|\bvisa\b|\bzip\b|postal|state of residence|^state$|\bcity\b|address|phone|mobile|country|relocat|notice period|start date|earliest.*start|when can you start|availab(le|ility) to start|previously (worked|employed)|ever (been )?employed by|criminal|background check|\bdrug|18 years|\bage of\b|\b(over|at least) 18\b|\b18 (or|and) (older|over|above)\b|\b18\+|security clearance|how did you hear|referr|pronoun|preferred (first )?name/i;
// Never kept: salary and essays change per role; commute and office questions depend on where each job is.
// "years of" is experience, not "18 years of age" (#1059). "Expected" is the pay ask, not an expected start or notice period (#1595).
const NEVER = /salary|compensation|pay|expected(?!\s+(start|notice|availability))|why|describe|tell us|cover letter|portfolio|years of(?! age)|commut|in.?office|hybrid|remote|location (listed|of the)|this (role|position|location)/i;
// Voluntary self-identification is never kept or shown to a model, even when a form asks it as a plain question (#1059).
const EEO = /ethnic|\brace\b|racial|hispanic|latin[oax]|gender|\bsex\b|sexual orientation|transgender|veteran|disabilit|self[- ]identif/i;

// Questions about one employer: a No is true almost everywhere, but a Yes or a referrer's name is about that company only.
// \b: "referr" sits inside "preferred", which made every preferred name a referrer's (#1048).
const ONE_EMPLOYER = /previously (worked|employed)|ever (been )?employed by|worked (here|for us)|\breferr/i;
// "When would you be available to start?" and "availability to start" too (#1596). "When are you able to start?", "How
// soon could you start?", "What date can you begin?" and "Earliest date you could join?" too (#1874), but not "When can
// you join a call?".
const START =
  /start date|earliest.*(start|join|begin)|when can you start|availab(le|ility) to start|\b(?:when|how soon|what date)\b[^?.]{0,30}?\b(?:can|could|would|will|are|might)\s+you\b[^?.]{0,20}?\b(?:start|begin|join)\b(?!\s+(?:a|an|the|our)\s+(?:call|interview|meeting|conversation|chat)\b)/i;
// A notice period that names a day ("Ends January 31", "My last day is Friday") is as dated as a start day (#1852).
const NOTICE = /notice period|how much notice/i;
// A calendar date ("12/1", "2026-12-01", "Dec 1", "June 1st", "1st December", "January 2027") passes;
// "2 weeks after an offer" stays true (#1079).
// Whole month names only: "dec" must not match "decision". "May" alone is a verb too, so it needs a day or year beside it.
const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b\.?/i;
// "2-3 weeks" and "4-6 weeks after an offer" are a span, not a day and month (#1575).
const DATE_FORMS = /\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b(?!\s*(?:business\s+|working\s+)?(?:days?|weeks?|wks?|months?|mos?)\b)|\b\d{4}-\d{2}-\d{2}\b|\bmay,?\s+(\d{1,2}|(19|20)\d{2})\b|\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?may\b|\b\d{1,2}(st|nd|rd|th)\b|\b(19|20)\d{2}\b/i;
// A day named from when it was written is one too: "Next Monday", "Tomorrow", "End of Q1", "After the holidays" (#1845).
const RELATIVE_DAY =
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|q[1-4]|holidays?|thanksgiving|christmas|xmas|new year(?:['’]s)?|easter)\b|\b(?:this|next|coming|following)\s+(?:week|month|year|quarter|spring|summer|fall|autumn|winter|season)\b|\bend of (?:the )?(?:week|month|year|quarter)\b|\b(?:spring|summer|fall|autumn|winter)\s+(?:19|20)?\d{2}\b/i;
const DATE = { test: (a: string) => MONTH.test(a) || DATE_FORMS.test(a) || RELATIVE_DAY.test(a) };

// "How did you hear about us?" answered with a referral, a friend or a recruiter is about that company; "LinkedIn" travels (#1097).
const HEARD = /how did you (hear|learn|find out)|where did you (hear|learn|find)/i;
const REFERRAL = /\breferr|\bemployee\b|\bfriend|\bcolleague|\bco-?worker|\brecruiter|\bhiring manager/i;

/** An answer that fits only the application it was given on, so it must not travel to the next one (#1032). */
export const onlyThisOne = (question: string, answer: string) =>
  (ONE_EMPLOYER.test(question) && !/^no\b/i.test(answer.trim())) || ((START.test(question) || NOTICE.test(question)) && DATE.test(answer)) || (HEARD.test(question) && REFERRAL.test(answer));

export const answerKey = (q: string) =>
  q
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * What the parentheses add to a question: "(United States)" or "(US roles)", but not a field marker like "(required)".
 * The key ignores parentheses so stored answers keep matching; reuse also needs this to agree (#1089).
 */
const qualifier = (q: string) =>
  [...q.toLowerCase().matchAll(/\((.*?)\)/g)]
    .map((m) => m[1].replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((t) => t && !/^(required|optional|y n|yes no|select one|choose one|please select|if applicable)$/.test(t))
    .join("|");

/** Is this question one we should remember the answer to? */
// Work authorization and sponsorship don't change with the role: "authorized to work in the United States for this
// position?" is the same fact everywhere, so "this role" or "this position" doesn't rule it out. "This location" still does (#1123).
const AUTH = /authori[sz]ed to work|work authori[sz]ation|legally (authorized|eligible|able|permitted)|(eligible|permitted) to work|right to work|work permit|sponsor|\bvisa\b/i;
// Where the job is, not where the person is: a US job's "No" to sponsorship "in the country where this role is based" is the
// wrong answer for a London job. Checked before "this role" is removed; "the country where you live" is still kept (#1227).
// "The country for which you are applying", "the country you're applying to" and "the location of this role" too (#1572).
// "The country of employment", "the country this role is in", "the country where you will be working" and "the hiring
// country" too (#1590). "The country listed on this job posting", "the job location", "the country where you will be based"
// and "this country" too (#1696).
// "The country you will be working in" without "where" too (#1748).
const MORE_PLACES =
  /\b(country|location)\s+(listed|named|shown|stated|posted)\s+(on|in|for)\s+(this|the)\s+(job\s+)?(posting|listing|advert|role|job|position)\b|\bjob location\b|\bposting['’]?s (country|location)\b|\b(country|location)\s+where\s+(this|the)\s+(role|job|position|opportunity)\s+is\b(?!\s+\w)|\bwhere you(?:['’]ll| will| would) be (based|employed|located)\b|\bin this country\b/i;
const JOB_PLACE_FIRST =
  /\b(role|job|position|opportunity) (is|will be) (based|located)\b|\b(role|job|position)'?s (country|location)\b|\b(country|location|place|region)\s+(?:(?:for|in|to) which\s+)?(you are|you're|you['’]re) applying\b|\b(country|location) of (this|the) (role|job|position|opportunity|posting)\b|\b(country|location|place) of (employment|hire)\b|\b(country|location|region|place)\s+(?:(?:where|that|which)\s+)?(this|the) (role|job|position|opportunity) is in\b|\b(country|location|region|place)\s+(?:(?:where|in which|that|which)\s+)?you(?:['’]ll| will| would)\s+(?:be\s+)?work(?:ing)?\b|\bhiring (country|location)\b/i;
// Which of the employer's sites the person wants, not where they live: "Which city are you applying for?", "Which city
// would you like to work in?", "preferred office location" (#1706). "What city do you live in?" and "What city do you
// work in?" are facts about the person and stay.
const JOB_SITE =
  /\b(?:which|what)\s+(?:city|office|site|location)s?\b[^?.]{0,40}?\b(?:(?:are|were)\s+you\s+(?:apply\w*|interested)|you(?:['’]re| are)\s+(?:apply\w*|interested)|(?:would|wish|want|like|prefer|hope|plan)\w*\s+(?:to\s+)?(?:be\s+)?(?:work\w*|join\w*|based))\b|\bpreferred\s+(?:work\s+|office\s+|job\s+)?(?:city|office|site|location)\b|\boffice location\b/i;
// Moving to the employer's own site, or for this one job: "Are you open to relocation to our headquarters?" and "willing to
// relocate to Austin for this job?" Each employer's headquarters is somewhere else, so the answer never travels (#1814).
// "Are you willing to relocate?" with no place is about the person and stays.
const RELOCATE_SITE =
  /\brelocat\w*\b[^?.]{0,40}?\b(?:to|near|for)\s+(?:(?:one|any)\s+of\s+)?(?:our|the company['’]?s|its)\s+(?:[\w-]+\s+){0,3}?(?:headquarters|hq|offices?|campus(?:es)?|sites?|locations?|hubs?|studios?)\b|\brelocat\w*\b[^?.]{0,60}?\bfor\s+(?:this|the)\s+(?:job|opportunity|role|position)\b/i;
// "The location(s) of this role", "the country(ies) for this position", "the posting country" and "the country where the
// vacancy is based" (#1818). The "(s)" broke "location of this role", and "vacancy" wasn't read like "role".
const PLURAL_PLACES =
  /\b(?:country|countries|location|locations)(?:\s*\((?:s|ies)\))?\s+(?:of|for)\s+(?:this|the)\s+(?:role|job|position|opportunity|posting|vacancy)\b|\bposting (?:country|location)\b|\bvacancy\b[^?.]{0,20}?\b(?:is|will be)\s+(?:based|located)\b|\b(?:country|location)\s+of\s+(?:this|the)\s+vacancy\b/i;
// "The country where you are applying", "the opportunity's location", "the advertised role" and "the advertised location"
// (#1893). "For which" and "in which" were read before; "where" was not, and "opportunity" and "vacancy" had no possessive.
// "How did you hear about this advertised position?" names no place and still travels.
const APPLYING_PLACES =
  /\b(?:country|countries|location|region|place)\s+(?:where|in which)\s+(?:you are|you['’]re)\s+applying\b|\b(?:opportunity|vacancy|posting|listing)['’]s\s+(?:country|location)\b|\badvertised\s+(?:location|country)\b|\b(?:country|location)\s+(?:of|for)\s+(?:the|this)\s+advertised\s+(?:role|job|position|vacancy|opportunity)\b/i;
const JOB_PLACE = new RegExp(
  `${JOB_PLACE_FIRST.source}|${MORE_PLACES.source}|${JOB_SITE.source}|${RELOCATE_SITE.source}|${PLURAL_PLACES.source}|${APPLYING_PLACES.source}`,
  "i",
);
// "How did you hear about this position?" is the same question as "...this job?", so it travels the same way (#1545).
const neverKept = (question: string) =>
  JOB_PLACE.test(question) || NEVER.test(AUTH.test(question) || HEARD.test(question) ? question.replace(/\bthis (role|position|job|opportunity)\b/gi, " ") : question);

export function isCommon(question: string, answer: string) {
  return (COMMON.test(question) || START.test(question)) && !neverKept(question) && !EEO.test(question) && answer.trim().length > 0 && answer.length <= 300 && !onlyThisOne(question, answer);
}

export function upsert(list: SavedAnswer[], question: string, answer: string): SavedAnswer[] {
  const key = answerKey(question);
  // Two places in parentheses are two questions, as `match` reads them: "(Canada)" never replaces "(United States)" (#1941).
  // Without one on either side it is the same question reworded: "Phone (mobile)" fixes "Phone" (#575).
  const q = qualifier(question);
  const rest = list.filter((s) => {
    if (s.key !== key) return true;
    const sq = qualifier(s.question);
    return !!q && !!sq && sq !== q;
  });
  return [...rest, { key, question: question.trim(), answer: answer.trim(), updatedAt: new Date().toISOString() }].sort((a, b) => a.question.localeCompare(b.question));
}

/** A saved answer for the same question, if it fits the form's choices. */
export function match(list: SavedAnswer[], question: string, options?: string[] | null): string | null {
  // Answers saved before #1032 may still hold one employer's Yes, and before #1227 one job's country: never reuse those.
  const hit = list.find((s) => s.key === answerKey(question) && qualifier(s.question) === qualifier(question) && !onlyThisOne(s.question, s.answer) && !EEO.test(s.question) && !JOB_PLACE.test(s.question));
  if (!hit) return null;
  if (!options?.length) return hit.answer;
  // The form's own spelling of the saved answer: "Full time" lands on "Full-time" (#1524).
  return sameOption(hit.answer, options) ?? null;
}

/** For the drafting prompt: the model may reuse these when a question means the same thing. */
export const savedBlock = (all: SavedAnswer[]) => {
  // An EEO answer saved before #1059, or one job's place saved before #1227 and #1706, never reaches the model.
  const list = all.filter((s) => !onlyThisOne(s.question, s.answer) && !EEO.test(s.question) && !JOB_PLACE.test(s.question));
  return list.length ? `\n\n<saved_answers from the person's earlier applications; reuse when a question asks the same thing, source "saved answer">\n${list.map((s) => `- ${s.question}: ${s.answer}`).join("\n")}\n</saved_answers>` : "";
};
