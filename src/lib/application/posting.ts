/**
 * Job postings carry company boilerplate around the real description: recruiting-fraud warnings,
 * EEO and accommodation statements, privacy notices, tracking tags. None of it describes the job,
 * and none of it belongs in a resume or cover letter (#114).
 */

const BOILERPLATE = [
  // recruiting-fraud notices
  /never (ask|request).*(payment|money|bank|fee)|official (company )?email|do not hire (someone )?through|verify (the|that the) (opportunity|recruiter)|real human connection|live conversations? with/i,
  // EEO, accommodation, legal
  /equal (employment )?opportunity|\beeo\b|reasonable accommodation|affirmative action|e-verify|protected (veteran|class)|without regard to (race|sex|age)|fair chance|arrest (and|or) conviction|background check (is|will be)|pay transparency (act|law)/i,
  // privacy and legal links
  /california residents|personal (information|data) (we|that we) collect|employeerights@/i,
  // tracking tags and link stubs
  /^#\S+$|^(click|learn more) here\.?$|curious how .* fits into/i,
];

// Privacy law and discrimination are the job for privacy, compliance and ML fairness roles; they're a notice only
// when the line speaks to applicants or links out (#651), the same way fraud needs hiring words (#509).
const LEGAL = /discriminat|privacy (notice|policy|statement)|\bccpa\b|\bgdpr\b|data protection (laws?|regulations?|officer|notice|act|rights)/i;
const NOTICE = /applicant|candidate|employee|employer|\bapplying\b|we collect|your (personal|data|information)|click here|learn more|https?:\/\/|residents|on the basis of|because of|regardless of/i;

// "Fraud" alone is the job for fraud and trust and safety roles; it's a notice only when it talks about hiring (#509).
const FRAUD = /scam|fraud|phishing|impersonat/i;
const HIRING = /recruit|candidate|applicant|job (offer|seeker|opening|posting)|offer letter|hiring process|\binterviews?\b|employment (offer|opportunit)|on (our )?behalf/i;

const isBoilerplate = (p: string) => BOILERPLATE.some((re) => re.test(p)) || (FRAUD.test(p) && HIRING.test(p)) || (LEGAL.test(p) && NOTICE.test(p));

/** Drop boilerplate paragraphs, keep everything that describes the job and the company. */
export function stripBoilerplate(text: string) {
  return text
    .split("\n")
    .filter((p) => !isBoilerplate(p.trim()))
    .join("\n");
}

const JUNK = /recruit|candidate|applicant|hiring|interview|verify|equal opportunit|\beeo\b|accommodation|open (roles|positions)|apply|application|job (posting|description)|opportunit(y|ies)$/i;
// Words that are boilerplate in most postings but the job itself in some (fraud analyst, insurance PM, social media manager) (#509).
const TOPIC = /scam|fraud|benefit|insurance|401\s?\(?k|\bpto\b|parental|privacy|e-?mail|social media/i;

/**
 * Keywords that describe the hiring process or the posting itself, not the job. With the posting, a topic word
 * still counts when the job text (boilerplate stripped) uses it.
 */
export const isJunkKeyword = (term: string, posting?: string) => {
  const t = term.trim();
  if (JUNK.test(t)) return true;
  if (!TOPIC.test(t)) return false;
  return !posting || !new RegExp(`(?<!\\w)${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`, "i").test(stripBoilerplate(posting));
};

// --- Traps (#116): text planted to catch automated applications. Never obey it silently.

export type Trap = { text: string; words: string[]; hidden: boolean };

const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*(0+(\.0*)?|\.0+)(px|pt|em|rem|%)?\s*(;|"|'|!)|font-size\s*:\s*1px|opacity\s*:\s*0(\.0*)?\s*(;|"|')|(?<![\w-])color\s*:\s*(#fff(fff)?\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255)|(?<![\w-])(left|top|text-indent)\s*:\s*-\d{3,}|height\s*:\s*0(px)?\s*;[^"']*overflow\s*:\s*hidden|clip\s*:\s*rect\(0/i;

const isHiddenTag = (attrs: string) => {
  const style = attrs.match(/\bstyle\s*=\s*("[^"]*"|'[^']*')/i);
  return (!!style && HIDDEN_STYLE.test(style[1])) || /\shidden(?=[\s>=/]|$)/i.test(attrs);
};

/** Where the element opened just before `from` ends, counting nested tags of the same name (#616). */
function closingTag(html: string, tag: string, from: number) {
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[1]) {
      if (--depth === 0) return { start: m.index, end: re.lastIndex };
    } else if (!m[0].endsWith("/>")) depth++;
  }
  return null;
}

/** Remove elements a human reader can't see. Only a scraper reads them, so they are never job content. */
export function stripHidden(html: string): { html: string; hidden: string[] } {
  const hidden: string[] = [];
  let out = "";
  let at = 0;
  const re = /<(\w+)\b([^>]*)>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].endsWith("/>") || !isHiddenTag(m[2])) continue;
    const close = closingTag(html, m[1], re.lastIndex);
    if (!close) continue;
    const t = html.slice(re.lastIndex, close.start).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (t) hidden.push(t);
    out += `${html.slice(at, m.index)} `;
    at = re.lastIndex = close.end;
  }
  return { html: out + html.slice(at), hidden };
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
  // Hidden text never reaches the model either way. Report it only when it instructs (or quotes words to
  // insert); menu labels and tracking tags ("Open Menu", "#LI-Remote") are routine and dropped quietly.
  const hidden = hiddenTexts.flatMap((h) => {
    const found = findTraps(h, true);
    if (found.length) return found;
    const words = quoted(h);
    return words.length ? [{ text: h.slice(0, 300), words, hidden: true }] : [];
  });
  let text = visibleText;
  for (const t of visible) text = text.split(t.text).join(" ");
  return { text, traps: [...hidden, ...visible] };
}

/** Trap words that slipped into a draft and aren't in the person's own materials. */
export const trapWordsIn = (draft: string, traps: Trap[], own: string) =>
  [...new Set(traps.flatMap((t) => t.words))].filter((w) => w.length > 1 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(draft) && !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(own));

// --- Display (#41): the stored posting text as readable blocks for the review screen.

export type PostingBlock = { t: "facts"; rows: [string, string][] } | { t: "heading"; text: string } | { t: "bullets"; items: string[] } | { t: "para"; text: string };

const FACT = /^(Role|Company|Location|Work mode|Pay range on file|Title|Job Title|Reports to|Exemption Status|Employment type|Department|[A-Za-z ]*Compensation Range|PAY ON PAGE \(text\)|Pay)\s*:\s*(.+)$/i;
const NOISE = /^(apply|back to jobs|apply now|share|save|job application for .+)$/i;

export function postingBlocks(text: string): PostingBlock[] {
  const lines = text
    .replace(/^STRUCTURED DATA:[\s\S]*?(?=^TEXT:)/m, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(TITLE:|TEXT:)/.test(l) && !NOISE.test(l));
  const facts: [string, string][] = [];
  const body: string[] = [];
  for (const l of lines) {
    const m = l.match(FACT);
    if (m && m[2].length < 120) {
      const k = m[1].replace(/^PAY ON PAGE \(text\)$/i, "Pay").replace(/^Pay range on file$/i, "Pay");
      if (!facts.some(([fk, fv]) => fk.toLowerCase() === k.toLowerCase() || fv === m[2])) facts.push([k, m[2]]);
    } else body.push(l);
  }
  const isHeading = (l: string, next?: string) => !!next && l.length <= 60 && !/[.,;!?]$/.test(l) && l.split(/\s+/).length <= 8 && (/:$/.test(l) || next.length > l.length);
  const out: PostingBlock[] = facts.length ? [{ t: "facts", rows: facts }] : [];
  let run: string[] = [];
  const flush = () => {
    // Three or more short lines in a row read as a list on the original page.
    if (run.length >= 3 && run.every((r) => r.length <= 260)) out.push({ t: "bullets", items: run.map((r) => r.replace(/^[•·*-]\s*/, "")) });
    else for (const r of run) out.push({ t: "para", text: r.replace(/^[•·*-]\s*/, "") });
    run = [];
  };
  body.forEach((l, i) => {
    if (isHeading(l, body[i + 1])) {
      flush();
      out.push({ t: "heading", text: l.replace(/:$/, "") });
    } else run.push(l);
  });
  flush();
  return out;
}
