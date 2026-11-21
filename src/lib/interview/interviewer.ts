import { z } from "zod";
import { topicKey } from "./rules";

/**
 * The interviewer (#1449): one model step per turn. It reads the person's last answer (if any), pulls out the facts
 * in their words, and picks the next question: a follow-up on the same topic, or a new gap from their top finds.
 * The rules it can't be trusted with (privacy locks, topics never to ask again, how deep a follow-up goes) are
 * held in code by the caller.
 */

export const INTERVIEW_SYSTEM = `You interview one job seeker for Lookout, an AI job search tool, the way a good recruiter would. You ask one short question at a time.

Your job each turn:
1. If the person just answered, pull out the facts in their answer.
2. Pick the next question.

Facts:
- Read facts from the newest answer only. Facts from earlier answers on this topic are already saved; never repeat them.
- Write each fact the way the person would put it on their resume, in their words, with no subject: "Led a 12-dinner touring supper series", "Hired 4 of the 12-person crew". Use "my" where a pronoun is needed ("My manager was skeptical"). Never write "they", "their", "the person" or "the candidate". Never add anything they did not say. No new numbers.
- One fact per claim: their part, the scope, the result. Keep numbers exactly as they said them ("about $240k").
- People: never write a person's name. Write their role instead ("my manager", "a client"). Set namesPerson true if the answer named a person.
- Set complaint true if the fact is a complaint or a negative remark about a person or employer.
- Set confidential true for an employer's confidential details: targets, client names, unreleased plans.
- Set personal true for health, family, past pay, or political or religious beliefs.
- If the answer has no fact (for example "not sure"), return no facts.

The next question:
- Questions come from gaps: things the person's top finds ask for that their resume and known facts don't show yet. Say the gap in the question, plainly ("3 of your top 5 finds ask for food and beverage program experience. Have you run F&B for events?").
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
  next: z.object({
    type: z.enum(["follow_up", "new_topic", "done"]),
    topic: z.string(),
    question: z.string(),
    why: z.string(),
  }),
});
export type InterviewTurnOut = z.infer<typeof InterviewTurnOut>;

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
export function shortWhy(why: string): string {
  const sentences = why.trim().match(/[^.!?]+[.!?]*/g) ?? [];
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
  /** Set on a retry: the topic the model picked that it may not ask. */
  refused?: string;
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
  return `<profile from the setup questions>\n${inp.profile || "(not given)"}\n</profile>\n\n<resume>\n${inp.resume.slice(0, 12000) || "(no resume yet)"}\n</resume>\n\n<known_facts>\n${facts.map((f) => `- ${f.text.slice(0, FACT_CHARS)}${f.shareable ? "" : " (private: understand it, never quote it)"}`).join("\n") || "(none yet)"}\n</known_facts>\n\n<top_finds the ${inp.finds.length} highest-match finds the person hasn't ruled out>\n${finds}\n</top_finds>\n\nTopics already covered: ${covered.join("; ") || "(none)"}\nNever ask again: ${closed.join("; ") || "(none)"}${inp.refused ? `\nYou picked "${inp.refused}", which is not allowed. Pick another topic or return "done".` : ""}${thread}`;
}
