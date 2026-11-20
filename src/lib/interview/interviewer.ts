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
- Write each fact in the person's own words, first person or plain phrasing ("Led a 12-dinner touring supper series"). Never add anything they did not say. No new numbers.
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
- why: one line, the reason for the question, for example "It's asked by 3 of your top 5 finds, and nothing in your resume backs it."
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
  const closed = [...new Set(inp.past.filter((p) => p.outcome === "skipped" || p.outcome === "not_applicable").map((p) => p.topic))];
  const covered = [...new Set(inp.past.filter((p) => p.outcome === "answered").map((p) => p.topic))];
  const thread = inp.thread?.length
    ? `\n\n<this_topic oldest first; the last answer is the one to read now>\n${inp.thread.map((t) => `Q: ${t.question}\nA: ${t.answer ?? "(no answer yet)"}`).join("\n")}\n</this_topic>\nFollow-ups left on this topic: ${inp.followUpsLeft}`
    : "\n\nNo answer to read this turn. Return no facts and pick the next question.";
  return `<profile from the setup questions>\n${inp.profile || "(not given)"}\n</profile>\n\n<resume>\n${inp.resume.slice(0, 12000) || "(no resume yet)"}\n</resume>\n\n<known_facts>\n${inp.facts.map((f) => `- ${f.text}${f.shareable ? "" : " (private: understand it, never quote it)"}`).join("\n") || "(none yet)"}\n</known_facts>\n\n<top_finds the ${inp.finds.length} highest-match finds the person hasn't ruled out>\n${finds}\n</top_finds>\n\nTopics already covered: ${covered.join("; ") || "(none)"}\nNever ask again: ${closed.join("; ") || "(none)"}${inp.refused ? `\nYou picked "${inp.refused}", which is not allowed. Pick another topic or return "done".` : ""}${thread}`;
}
