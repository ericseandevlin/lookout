import { z } from "zod";
import { topicKey } from "./rules";

/**
 * The interviewer (#1449): one model step per turn. It reads the person's last answer (if any), pulls out the facts
 * in their words, and picks the next question: a follow-up on the same topic, or a new gap from their top finds.
 * The rules it can't be trusted with (privacy locks, topics never to ask again, how deep a follow-up goes) are
 * held in code by the caller.
 */

/** How Lookout asks (#1449, #1485): a question that draws out a story with the detail drafts need later, not a yes or no. */
export const STORY_RULES = `- Ask for a story, not a yes or no: where they did it (which role or company), what they did themselves, how big it was (people, budget, how many) and what came of it, with a number if they have one.
- Ground it in their resume when you can: name the role, company or project where it most likely happened, inside the question itself. Never assume they did it; let them say where, or that they haven't.
- One question, warm and easy to answer, in plain words. Two short parts are fine; never a list of five things.
  Bad: "Have you managed managers?"
  Good: "Tell me about a time you led other managers, maybe at Harbor Hall. How many people, and what changed?"`;

/** How a fact is written and flagged, shared by every interview prompt. */
export const FACT_RULES = `- Write each fact the way the person would put it on their resume, in their words, with no subject: "Led a 12-dinner touring supper series", "Hired 4 of the 12-person crew". Use "my" where a pronoun is needed ("My manager was skeptical"). Never write "they", "their", "the person" or "the candidate". Never add anything they did not say. No new numbers.
- One fact per claim: their part, the scope, the result. Keep numbers exactly as they said them ("about $240k").
- People: never write a person's name. Write their role instead ("my manager", "a client"). Set namesPerson true if the answer named a person.
- Set complaint true if the fact is a complaint or a negative remark about a person or employer.
- Set confidential true only for what an employer would not want public: a named client, internal targets or forecasts, unreleased products or plans. A result with numbers and no names is not confidential, and is what drafts need: "Redesigned the admin console for a 300-location account, cutting setup from 2 weeks to 3 days" is confidential false.
- Set personal true for health, family, past pay, or political or religious beliefs.
- If the answer has no fact (for example "not sure"), return no facts.`;

export const INTERVIEW_SYSTEM = `You are a seasoned executive recruiter interviewing one job seeker for Lookout, an AI job search tool. You coach them to tell the stories that win interviews, and you draw out the detail they would leave out on their own. You start from something concrete in their resume: a named role, company or project. You ask one open question at a time, and you never settle for a bare "yes".

Your job each turn:
1. If the person just answered, pull out the facts in their answer.
2. Pick the next question.

Facts:
- Read facts from the newest answer only. Facts from earlier answers on this topic are already saved; never repeat them.
${FACT_RULES}

The next question:
- If there are priority keywords, ask about them first, in their order, before any gap from the finds. One story can cover several related keywords. For a priority question, topic is the keyword or keywords it covers, copied exactly and joined with ", ".
- Questions come from gaps: things the person's top finds ask for that their resume and known facts don't show yet. Read the resume and the known facts first. Never ask for something they already state: if the resume says "Led a team of 3 designers", don't ask how big the team was.
- closest: the resume line or known fact closest to your question, copied exactly. Empty if none. If it already answers your question, pick another question.
- If there are no finds yet, gaps come from the next role they want and their resume. Then why cites that, and never mentions finds.
- question: no evidence and no preamble, no "your finds". The evidence goes in why, which the person sees only if they ask.
  Bad: "4 of your top 5 finds are B2B SaaS companies, and your resume shows fashion, media and agency work. Have you worked on B2B or enterprise SaaS products?"
  Good: "Tell me about B2B or enterprise software you've worked on: the product, your part, and how many customers used it."
${STORY_RULES}
- If the newest answer is a question back to you ("why do you ask?", "what do you mean?"), it is not an answer: return no facts, and use "follow_up" on the same topic with a question that answers theirs in one short sentence, then asks the same question again. For example "Most of your top finds sell software to businesses. Have you worked on B2B or enterprise SaaS products?" This does not use up a follow-up.
- A bare "yes" or a thin answer is not a story. Follow up and ask for it: where, their part, how big, and what came of it.
- Never make the whole question "Have you done X?" or another yes or no question.
- After an answer that claims something, follow up to get what a recruiter needs: their exact part (led it or was on the team), the scope (budget, team size, how many), and a number for the result. Ask only for what is still missing. Use "follow_up" and keep the same topic.
- When the topic has their part, the scope and a number, or follow-ups left is 0, move to a new topic with "new_topic".
- Never ask about a topic in the "never ask again" list or one already covered. Never ask about pay, health, family, age or other protected traits.
- If no real gap is left, return "done".
- why: the evidence only, in one short clause: which finds ask for it. The person already knows the resume doesn't show it; that is why you ask. Never say what the resume or profile lacks, and never repeat the question.
  Bad: "4 of your top 5 finds ask for B2B SaaS or enterprise product experience, and nothing in your resume clearly shows it."
  Good: "4 of your top 5 finds ask for B2B SaaS or enterprise product experience."
- topic: two to five plain words naming the skill or area, for example "food and beverage programs".
- Short sentences, plain words, warm and direct. No em dashes. One question only.`;

export const FactOut = z.object({
  text: z.string(),
  kind: z.enum(["result", "skill", "project", "background", "next_role"]),
  namesPerson: z.boolean(),
  complaint: z.boolean(),
  confidential: z.boolean(),
  personal: z.boolean(),
});

export const InterviewTurnOut = z.object({
  facts: z.array(FactOut),
  backs: z.array(z.string()).describe("Priority keywords the newest answer shows the person did themselves, copied exactly. Empty if none, or if there are no priority keywords"),
  next: z.object({
    type: z.enum(["follow_up", "new_topic", "done"]),
    topic: z.string(),
    question: z.string(),
    why: z.string(),
    closest: z.string().describe("The resume line or known fact closest to the question, copied exactly; empty if none"),
  }),
});
export type InterviewTurnOut = z.infer<typeof InterviewTurnOut>;

/** The follow-up after a bare yes, when the model asks none: where, what and how big (#1485). */
export const STORY_FOLLOW_UP = "Where was that, what was your part, and how big was it?";
/** Put after a yes or no question so it asks for the story too. */
export const STORY_ASK = "Tell me where, your part, and how big it was.";

/**
 * A yes or no question with nothing else to it (#1485): "Have you led production for large events?". A question that
 * goes on to ask for the story ("Have you led X? Tell me where.") is fine.
 */
export function isYesNoQuestion(q: string) {
  const parts = q.trim().match(/[^.!?]+[.!?]*/g) ?? [];
  return parts.length === 1 && /^(have|has|did|do|does|are|were|was|is|can|could|would) you\b/i.test(parts[0].trim());
}

/**
 * What one turn sends stays the same size however long the interview runs: the topic being dug into (at most
 * 1 + MAX_FOLLOW_UPS questions), the newest facts and the newest topic names. Older topics are still refused in code.
 */
export const FACTS_IN_PROMPT = 60;
export const TOPICS_IN_PROMPT = 60;
const FACT_CHARS = 300;

const BOUNDARY = /(?:,\s*(?:and|but|while|yet|though)?|;|\s(?:and|but|while|yet|though)|\s[-\u2013\u2014])\s/gi;
const LACKS = /\b(?:nothing|no|not|never|lacks?|lacking|missing|without|thin|silent|unclear)\b|n't\b/i;

/**
 * The reason, cut to its evidence (#1449). Drops a clause about what the resume lacks ("..., and nothing in your
 * resume clearly shows it", "but your resume doesn't show it", "Nothing in your resume backs it."). Run when a reason
 * is saved and when it is shown, so reasons written before the prompt changed read short too.
 */
/** Em and en dashes become a comma, so a generated line never carries one (#1531). */
export const noDashes = (s: string) => s.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/,\s*,/g, ",");

/**
 * A question for a number the resume or a known fact already gives (#1531): "How many designers were on that team?"
 * when the resume says "Led a team of 3 designers". The model names the closest line; code checks that line is
 * really there and holds a number.
 */
export function asksWhatIsKnown(question: string, closest: string, known: string) {
  const c = closest.trim();
  if (c.length < 8 || !/\d/.test(c) || !/\b(how (many|much|big|large|long)|what (size|number|budget|percent))\b/i.test(question)) return false;
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return flat(known).includes(flat(c));
}

// The prompt's own examples and field names, when a model runs on past the reason into them.
const LEAK = /\s*(?:\b(?:Bad|Good):\s*["\u201c]|\s-\s(?:topic|question|why|facts|backs):)/;

/** One sentence. A point inside a number ("1.9", "0.6") does not end it (#1662). */
const SENTENCE = /(?:[^.!?]|\.(?=\d))+[.!?]*/g;

export function shortWhy(why: string): string {
  why = noDashes(why);
  const leak = why.search(LEAK);
  if (leak > 0) why = why.slice(0, leak);
  const sentences = why.trim().match(SENTENCE) ?? [];
  const kept: string[] = [];
  for (const raw of sentences) {
    const t = raw.trim();
    const at = t.search(/\b(?:resume|cv|profile)\b/i);
    if (at < 0) {
      kept.push(t);
      continue;
    }
    let cut = 0;
    for (const m of t.slice(0, at).matchAll(BOUNDARY)) cut = m.index;
    if (!LACKS.test(t.slice(cut))) kept.push(t);
    else if (cut > 0) kept.push(`${t.slice(0, cut).trim()}.`);
  }
  const out = kept.join(" ").trim();
  return out || why.trim();
}

/**
 * The question only (#1449): statements before it are cut, since the evidence lives in the reason tooltip.
 * "4 of your top 5 finds are B2B SaaS companies. Have you worked on B2B SaaS?" becomes "Have you worked on B2B SaaS?".
 * Only leading sentences that cite the finds, the resume or the posting go; a statement the question leans on stays.
 */
const EVIDENCE = /\b(finds?|resume|profile|postings?)\b/i;
export function plainQuestion(q: string): string {
  q = noDashes(q);
  const parts = q.trim().match(SENTENCE) ?? [];
  const first = parts.findIndex((p) => p.trim().endsWith("?"));
  // Only statements that cite the evidence go. One that sets up the question stays, or the question
  // reads "Which one, and how far along are you?" with nothing to point at (#1662).
  const last = first > 0 ? first : parts.length - 1;
  let i = 0;
  while (i < last && EVIDENCE.test(parts[i])) i++;
  return parts.slice(i).join("").trim();
}

export type TopFind = { company: string; title: string; gaps: string[]; matches: string[]; text: string };
export type KnownFact = { text: string; shareable: boolean };
export type PastTurn = { topic: string; outcome: string };

export type InterviewInput = {
  profile: string;
  resume: string;
  finds: TopFind[];
  facts: KnownFact[];
  past: PastTurn[];
  /** The topic being dug into: its questions and answers so far, oldest first, the last answer included. */
  thread?: { question: string; answer: string | null }[];
  followUpsLeft: number;
  /** Set on a retry: the topic the model picked that it may not ask, and why when it is not just the topic. */
  refused?: string;
  refusedWhy?: string;
  /** Keywords a job they are applying to asks for that their resume doesn't show yet: asked about first (#1485). */
  priority?: string[];
};

/** Topics never to ask again: skipped or doesn't apply. */
export const closedTopics = (past: PastTurn[]) => new Set(past.filter((p) => p.outcome === "skipped" || p.outcome === "not_applicable").map((p) => topicKey(p.topic)));

export function interviewPrompt(inp: InterviewInput) {
  const finds = inp.finds.length
    ? inp.finds
        .map((f, i) => `${i + 1}. ${f.title} at ${f.company}\n   Gaps Lookout saw: ${f.gaps.join("; ") || "(none listed)"}\n   Matches: ${f.matches.join("; ") || "(none listed)"}\n   Posting excerpt: ${f.text.replace(/\s+/g, " ").slice(0, 900)}`)
        .join("\n")
    : "(no finds yet)";
  // Newest first, so a cap keeps the topics nearest in time.
  const newest = [...inp.past].reverse();
  const closed = [...new Set(newest.filter((p) => p.outcome === "skipped" || p.outcome === "not_applicable").map((p) => p.topic))].slice(0, TOPICS_IN_PROMPT);
  const covered = [...new Set(newest.filter((p) => p.outcome === "answered").map((p) => p.topic))].slice(0, TOPICS_IN_PROMPT);
  const facts = inp.facts.slice(-FACTS_IN_PROMPT);
  const thread = inp.thread?.length
    ? `\n\n<this_topic oldest first; read facts from the newest answer only>\n${inp.thread
        .map((t, i, all) => `Q: ${t.question}\nA${i === all.length - 1 ? " (newest: read this one)" : " (facts already saved)"}: ${t.answer ?? "(no answer)"}`)
        .join("\n")}\n</this_topic>\nFollow-ups left on this topic: ${inp.followUpsLeft}`
    : "\n\nNo answer to read this turn. Return no facts and pick the next question.";
  return `<profile from the setup questions>\n${inp.profile || "(not given)"}\n</profile>\n\n<resume>\n${inp.resume.slice(0, 12000) || "(no resume yet)"}\n</resume>\n\n<known_facts>\n${facts.map((f) => `- ${f.text.slice(0, FACT_CHARS)}${f.shareable ? "" : " (private: understand it, never quote it)"}`).join("\n") || "(none yet)"}\n</known_facts>\n\n<top_finds the ${inp.finds.length} highest-match finds the person hasn't ruled out>\n${finds}\n</top_finds>\n\nTopics already covered: ${covered.join("; ") || "(none)"}\nNever ask again: ${closed.join("; ") || "(none)"}${inp.priority?.length ? `\n\n<priority_keywords from a job they are applying to; ask about these first>\n${inp.priority.map((t) => `- ${t}`).join("\n")}\n</priority_keywords>` : ""}${inp.refused ? `\nYou picked "${inp.refused}", which is not allowed${inp.refusedWhy ? `: ${inp.refusedWhy}` : ""}. Pick another question or return "done".` : ""}${thread}`;
}
