import { describe, expect, it } from "vitest";
import { isJunkKeyword, stripBoilerplate } from "./posting";

// Paragraphs from Red Ventures' Group AI Product Manager posting (Greenhouse), 2026-10-17.
const job = [
  "Own outcomes: Own the P&L and business impact of your initiatives, communicating progress, ROI, risks, and opportunities to leadership.",
  "Built from experience: You've worked hands-on with production-grade AI systems, running analyses (sql, python), building agentic workflows.",
  "New York City Total Cash Compensation Range: $230,000-$260,000",
  "Red Ventures is a global portfolio of high-growth companies spanning several U.S. businesses.",
];
const boilerplate = [
  "Red Ventures is an equal opportunity employer that does not discriminate against any employee or applicant because of race, creed, color.",
  "We are committed to providing equal employment opportunities to qualified individuals with disabilities. This includes providing reasonable accommodation where appropriate.",
  "#li-ac2",
  "#li-hybrid",
  "At Red Ventures, we believe in real human connection. That's why we do not hire someone through text, social media, or email only. As part of the hiring process, you should expect live conversations with RV teammates before an offer.",
  "For more, the U.S. Federal Trade Commission has published helpful articles to help individuals learn more about protecting themselves from recruiter scams.",
  "Click here for more details regarding the employee privacy policy: https://www.redventures.com/legal/us-emp-privacy-notice",
  "Curious how Home fits into Red Ventures?  Click here .",
];

describe("stripBoilerplate", () => {
  it("keeps the job and the company, drops fraud, EEO, privacy and tracking text", () => {
    const out = stripBoilerplate([...job, ...boilerplate].join("\n"));
    expect(out.split("\n")).toEqual(job);
  });
});

describe("isJunkKeyword", () => {
  it("drops hiring-process words, keeps real skills", () => {
    for (const k of ["recruiter scams", "candidates", "verify the opportunity", "hiring process", "open roles", "official email addresses", "social media", "401(k)"]) expect(isJunkKeyword(k)).toBe(true);
    for (const k of ["agentic workflows", "P&L ownership", "SQL", "AI/ML products", "product strategy", "market opportunity sizing"]) expect(isJunkKeyword(k)).toBe(false);
  });
});
