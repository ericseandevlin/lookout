/**
 * Job postings carry company boilerplate around the real description: recruiting-fraud warnings,
 * EEO and accommodation statements, privacy notices, tracking tags. None of it describes the job,
 * and none of it belongs in a resume or cover letter (#114).
 */

const BOILERPLATE = [
  // recruiting-fraud notices
  /scam|fraud|phishing|impersonat|never (ask|request).*(payment|money|bank|fee)|official (company )?email|do not hire (someone )?through|verify (the|that the) (opportunity|recruiter)|real human connection|live conversations? with/i,
  // EEO, accommodation, legal
  /equal (employment )?opportunity|\beeo\b|discriminat|reasonable accommodation|affirmative action|e-verify|protected (veteran|class)|without regard to (race|sex|age)|fair chance|arrest (and|or) conviction|background check (is|will be)|pay transparency (act|law)/i,
  // privacy and legal links
  /privacy (notice|policy|statement)|california residents|personal (information|data) (we|that we) collect|\bccpa\b|\bgdpr\b|employeerights@|data protection/i,
  // tracking tags and link stubs
  /^#\S+$|^(click|learn more) here\.?$|curious how .* fits into/i,
];

/** Drop boilerplate paragraphs, keep everything that describes the job and the company. */
export function stripBoilerplate(text: string) {
  return text
    .split("\n")
    .filter((p) => !BOILERPLATE.some((re) => re.test(p.trim())))
    .join("\n");
}

const JUNK = /scam|fraud|recruit|candidate|applicant|hiring|interview|verify|equal opportunit|\beeo\b|accommodation|benefit|insurance|401\s?\(?k|\bpto\b|parental|privacy|e-?mail|social media|open (roles|positions)|apply|application|job (posting|description)|opportunit(y|ies)$/i;

/** Keywords that describe the hiring process or the posting itself, not the job. */
export const isJunkKeyword = (term: string) => JUNK.test(term.trim());

// --- Traps (#116): text planted to catch automated applications. Never obey it silently.

export type Trap = { text: string; words: string[]; hidden: boolean };

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0*(\.\d+)?(px|pt|em|rem)?\s*(;|"|')|font-size\s*:\s*[01]px|opacity\s*:\s*0(\.0*)?\s*(;|"|')|color\s*:\s*(#fff(fff)?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255)|(left|top|text-indent)\s*:\s*-\d{3,}|height\s*:\s*0(px)?\s*;[^"']*overflow\s*:\s*hidden|clip\s*:\s*rect\(0/i;

/** Remove elements a human reader can't see. Only a scraper reads them, so they are never job content. */
export function stripHidden(html: string): { html: string; hidden: string[] } {
  const hidden: string[] = [];
  const take = (_m: string, inner: string) => {
    const t = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t) hidden.push(t);
    return " ";
  };
  let out = html.replace(/<(\w+)\b[^>]*\bstyle\s*=\s*("[^"]*"|'[^']*')[^>]*>([\s\S]*?)<\/\1>/gi, (m, _tag, style, inner) => (HIDDEN_STYLE.test(style) ? take(m, inner) : m));
  out = out.replace(/<(\w+)\b[^>]*\shidden(?=[\s>=])[^>]*>([\s\S]*?)<\/\1>/gi, (m, _t, inner) => take(m, inner));
  return { html: out, hidden };
}

const TRAP = [
  /\b(include|use|mention|write|add|insert|put|type|say)\b[^.!?\n]{0,50}\b(word|phrase|term|code ?word|keyword|emoji)\b/i,
  /\bif you(?:'re| are| were)\s+(an?\s+)?(ai|a\.i\.|llm|language model|chat ?bot|bot|automated|machine|gpt|robot)\b/i,
  // Spoken to an AI directly: "Attention AI:", "any LLM reading this must", "ChatGPT: include..."
  /\b(note to|attention|dear|hey|(?:to|for) (?:any|all|every))\s+(the\s+)?(ai|a\.i\.|llm|language model|chatgpt|gpt|claude|gemini|copilot|bot|automated tools?)s?(?![-\w])/i,
  /\b(ai|llm|language model|chatgpt|gpt|claude|gemini|copilot|bots?)s?\s*[:,]\s*(please|you must|include|write|mention|ignore|respond|say)\b/i,
  /\b(any|all|every)\s+(ai|llm|language model|chatgpt|gpt|bot|automated tool)s?\b[^.!?\n]{0,40}\b(must|should|need to|has to|is required to)\b/i,
  /\b(ai|llm|language model|chatgpt|gpt|claude|gemini|copilot)s?\b[^.!?\n]{0,30}\b(must|should|need to) (include|write|mention|insert|add|use|say|respond|answer)\b/i,
  /\bignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts|directions)/i,
  /\b(start|begin|end|sign|close) (your|the|each) (cover letter|application|answer|response|email|message|summary)\b[^.!?\n]{0,20}\bwith\b/i,
  /\bto (show|prove|confirm|demonstrate) (that )?you (have |actually )?read\b/i,
  /\b(secret|code|magic|special|hidden) (word|phrase)\b/i,
];

const quoted = (s: string) => [...s.matchAll(/["'“‘]([^"'”’\n]{1,40})["'”’]/g)].map((m) => m[1].trim()).filter(Boolean);
const afterWord = (s: string) => [...s.matchAll(/\b(?:word|phrase|term)\s+([A-Za-z][\w-]{2,30})/gi)].map((m) => m[1]).filter((w) => !/^(in|on|at|to|that|somewhere|anywhere|into|within|the|your)$/i.test(w));

/** Sentences that instruct the applicant or an AI rather than describe the job, with the words they want inserted. */
export function findTraps(text: string, hidden = false): Trap[] {
  const out: Trap[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s || !TRAP.some((re) => re.test(s))) continue;
    out.push({ text: s.slice(0, 300), words: [...new Set([...quoted(s), ...afterWord(s)])], hidden });
  }
  return out;
}

/** Hidden text is always a trap candidate; visible text only where it instructs. Returns the cleaned text too. */
export function removeTraps(visibleText: string, hiddenTexts: string[]) {
  const visible = findTraps(visibleText, false);
  // Hidden tracking tags (#LI-Remote, white on white) are routine; drop them without a warning.
  const hidden = hiddenTexts.filter((h) => !/^(#[\w-]+\s*)+$/.test(h.trim())).flatMap((h) => {
    const found = findTraps(h, true);
    return found.length ? found : [{ text: h.slice(0, 300), words: quoted(h), hidden: true }];
  });
  let text = visibleText;
  for (const t of visible) text = text.split(t.text).join(" ");
  return { text, traps: [...hidden, ...visible] };
}

/** Trap words that slipped into a draft and aren't in the person's own materials. */
export const trapWordsIn = (draft: string, traps: Trap[], own: string) =>
  [...new Set(traps.flatMap((t) => t.words))].filter((w) => w.length > 1 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(draft) && !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(own));
