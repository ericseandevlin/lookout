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
  { key: "80_120", label: "$80K – $120K", floor: "$80,000", target: "$120,000" },
  { key: "120_160", label: "$120K – $160K", floor: "$120,000", target: "$160,000" },
  { key: "160_220", label: "$160K – $220K", floor: "$160,000", target: "$220,000" },
  { key: "220p", label: "$220K and up", floor: "$220,000", target: "$280,000" },
] as const;
export type SalaryKey = (typeof SALARY_RANGES)[number]["key"];

export const WORK_MODES = ["On-site", "Hybrid", "Remote"] as const;
