import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
vi.mock("@/lib/ai/llm", () => ({ completeJSON: vi.fn() }));
const { looseDates } = await import("./master");

// From Eric's extracted resume text: one heading shares a line with its dates, the others don't.
const source = `Freelance Web Development New York, NY • 03/2016 - 11/2017
New York, NY • 03/2004 - 01/2015
New York, NY • 01/2016 - 04/2016
The Weather Company (IBM)
Computer Lunch
Fashion Accessories Director`;

describe("looseDates", () => {
  it("flags dates the rebuild paired with a job they weren't next to", () => {
    const md = `### Freelance Web Development | New York, NY | 03/2016 – 11/2017
### The Weather Company (IBM) | New York, NY | 01/2016 – 04/2016
### Computer Lunch | New York, NY | 03/2004 – 01/2015
### Fashion Accessories Director | New York, NY`;
    const out = looseDates(md, source);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/01\/2016 – 04\/2016.*The Weather Company/);
    expect(out[1]).toMatch(/Computer Lunch/);
  });
});
