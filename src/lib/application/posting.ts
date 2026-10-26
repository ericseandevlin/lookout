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

// Paragraphs that only appear in pay-transparency notes, legal disclaimers, application instructions and "about us" blurbs.
const BOILERPLATE_MORE = [
  /\b(the|this) (salary|pay|base pay|compensation|hiring) range (for this|is|reflects|listed|displayed|above|below)|actual (pay|compensation|salary|offer)s? (will|may|could) (be|vary)|(may|will) vary (based|depending) (on|upon)|pay range(s)? (is|are) (determined|based)|in compliance with .*(pay|wage|salary)/i,
  /\bdisclaimer\b|nothing in this (job )?(posting|description)|not (intended to be |meant to be )?(an )?(exhaustive|all-inclusive|comprehensive) list|\bat-will\b|reserves the right to/i,
  /^to apply\b|\bplease (submit|apply|send|upload|include) (your |a )?(resume|cv|application|cover letter|portfolio)|applications? (will be|are) (accepted|reviewed|considered)|\b(how|where) to apply\b|selected candidates will be|only (shortlisted|selected) candidates/i,
];

/** Section headings whose whole section is company boilerplate, not the job (#114). */
const BOILER_HEADING =
  /^(our |a |an |important )?(fraud|scam|beware of (recruit\w*|fraud|scam)s?|(note|warning|notice|alert) (on|about|regarding) (recruit\w*|fraud|scam)s?( fraud| scams?)?|recruit(ing|ment|er)? (fraud|scams?)|equal (employment )?opportunity( employer)?|eeo|eeoc|diversity,? (equity|inclusion)(,? (&|and) (inclusion|belonging))?|(reasonable )?accommodations?|(legal )?disclaimer|legal|privacy|pay transparency|salary transparency|compensation (transparency|disclosure)|about us|who we are|about the company|(our )?(company|story)|how to apply|application (instructions|process)|to apply|(our )?(hiring|interview) process|(our |the )?benefits|(work )?perks|what we offer|compensation|compensation,? (&|and) (work )?(perks|benefits)|benefits,? (&|and) perks)( (notice|statement|policy|alert|warning|information|disclosure|act|law|commitment|(&|and) perks|(&|and) benefits))*$/i;

/** Headings that start the job again: responsibilities, requirements, the role, the team. */
const JOB_HEADING =
  /^(about (the|this) (role|position|job|team|opportunity)|about you|the role|the team|the opportunity|role overview|position (overview|summary)|(job )?(summary|overview|description)|responsibilities|key responsibilities|what you('|’)?ll (do|own|bring|work on)|what (we're|we are|you'll be) (looking for|doing)|in this role|requirements|qualifications|(minimum|basic|preferred|required) qualifications|skills|experience|nice to have|bonus points|who you are|you (have|are|bring)|your (role|impact|responsibilities)|day to day|what success looks like)/i;

const PAY_FACT = /\$\s?\d|total cash|includ\w* (a )?(target )?bonus|\bOTE\b|\bbase (salary|pay|compensation)\b/i;

/** Facts the answers need even when a notice section carries them: pay, sponsorship, work authorization. */
const KEEP_FACT = /\$\s?\d|total cash|\bOTE\b|\bbase (salary|pay|compensation)\b|sponsor|\bvisa\b|work authori[sz]ation|authori[sz]ed to work/i;

/** One paragraph that is company boilerplate. A line with a pay figure is a fact, never boilerplate. */
export const isBoilerplate = (line: string) => [...BOILERPLATE, ...BOILERPLATE_MORE].some((re) => re.test(line.trim())) && !(PAY_FACT.test(line) && /\$\s?\d/.test(line));

const headingLike = (l: string) => l.length > 0 && l.length <= 70 && l.split(/\s+/).length <= 9 && !/[.;!?,]$/.test(l);

/**
 * Split a posting into the job and its company boilerplate. Sections under a boilerplate heading go,
 * up to the next job heading; without headings, paragraphs that carry boilerplate phrases go (#114).
 * Pay figures stay even inside a pay-transparency section: salary asks read them.
 */
export function splitBoilerplate(text: string, company?: string) {
  const aboutCompany = company?.trim() ? new RegExp(`^(about|why|life at|working at|join|benefits at) ${company.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( inc\\.?| llc)?$`, "i") : null;
  const kept: string[] = [];
  const removed: string[] = [];
  let inSection = false;
  for (const line of text.split("\n")) {
    const l = line.trim().replace(/^#+\s*/, "").replace(/:$/, "");
    const heading = headingLike(l);
    if (heading && (BOILER_HEADING.test(l) || aboutCompany?.test(l))) {
      inSection = true;
      removed.push(line);
      continue;
    }
    if (heading && JOB_HEADING.test(l)) inSection = false;
    if (inSection) {
      if (KEEP_FACT.test(line)) kept.push(line);
      else removed.push(line);
      continue;
    }
    if (isBoilerplate(line)) removed.push(line);
    else kept.push(line);
  }
  return { text: kept.join("\n"), removed: removed.map((r) => r.trim()).filter(Boolean) };
}

/** Drop boilerplate sections and paragraphs, keep everything that describes the job and the company. */
export const stripBoilerplate = (text: string, company?: string) => splitBoilerplate(text, company).text;

const JUNK = /scam|fraud|recruit|candidate|applicant|hiring|interview|verify|equal opportunit|\beeo\b|accommodation|benefit|insurance|401\s?\(?k|\bpto\b|parental|privacy|e-?mail|social media|open (roles|positions)|apply|application|job (posting|description)|opportunit(y|ies)$|\bbonus|salary|pay (range|transparency)|compensation (range|package)|base pay|total cash|disclaimer|at-will|discriminat|diversity|inclusive (workplace|environment)|sponsor|\bvisa\b|work authori/i;

// --- Phrases lifted from boilerplate (#114): a draft should carry none of them.

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9&+#' ]+/g, " ").split(/\s+/).filter(Boolean);
const shingles = (s: string, n = 4) => {
  const w = words(s);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
};

/**
 * Four-word runs from the removed boilerplate that show up in a draft, unless the job text or the
 * person's own materials also use them ("the ability to work" is everywhere; "real human connection" is not).
 */
export function boilerplateIn(draft: string, removed: string[], job: string, own: string) {
  if (!removed.length) return [];
  const common = new Set([...shingles(job), ...shingles(own)]);
  const hits = [...shingles(draft)].filter((g) => !common.has(g) && removed.some((r) => shingles(r).has(g)));
  // Merge overlapping runs into the phrases a reader would recognize.
  const phrases: string[] = [];
  for (const g of hits) if (!phrases.some((p) => p.includes(g))) phrases.push(g);
  return phrases.slice(0, 5);
}

// --- Where each keyword came from (#114): the posting line that carries it.

/** Fewer real keywords than this and the posting has too little skill text to tailor from. */
export const MIN_KEYWORDS = 5;
export const THIN_KEYWORDS = "Not enough skill text in this posting.";

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
