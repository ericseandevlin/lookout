// Quick-tap choices used at request-access and on the welcome step.
// Each one pre-fills a profile answer the person can edit later.

export const NEXT_MOVES = [
  { key: "step_up", label: "A step up: director, head of or VP", q1: "A step up to a director, head-of or VP role" },
  { key: "bigger", label: "A bigger role at my level", q1: "A bigger role at my current level, at a stronger company" },
  { key: "switch", label: "A switch into a new field", q1: "A move into a new field" },
  { key: "return", label: "Back to work after a break", q1: "Getting back to work after a break" },
  { key: "freelance", label: "Freelance or contract work", q1: "Freelance or contract work" },
] as const;
export type NextMoveKey = (typeof NEXT_MOVES)[number]["key"];

/** Base salary ranges. The low end becomes the floor, the high end what they'd jump for. */
export const SALARY_RANGES = [
  { key: "lt80", label: "Under $80K", floor: "$60,000", target: "$80,000" },
  { key: "80_120", label: "$80K to $120K", floor: "$80,000", target: "$120,000" },
  { key: "120_170", label: "$120K to $170K", floor: "$120,000", target: "$170,000" },
  { key: "170_250", label: "$170K to $250K", floor: "$170,000", target: "$250,000" },
  { key: "250p", label: "$250K and up", floor: "$250,000", target: "$320,000" },
] as const;
export type SalaryKey = (typeof SALARY_RANGES)[number]["key"];

/** Keys from before the bands widened (#252), mapped to the nearest new band so an open tab still saves. */
export const OLD_SALARY_KEYS: Record<string, SalaryKey> = { "120_160": "120_170", "160_220": "170_250", "220p": "250p" };

export function salaryRange(key: string | undefined) {
  const k = key && (OLD_SALARY_KEYS[key] ?? key);
  return SALARY_RANGES.find((r) => r.key === k);
}

/** Label for the On-site / Hybrid / Remote choice, as LinkedIn and Indeed name it. */
export const WORK_MODE_LABEL = "Workplace type";

export const WORK_MODES = ["On-site", "Hybrid", "Remote"] as const;
