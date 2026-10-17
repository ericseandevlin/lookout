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
