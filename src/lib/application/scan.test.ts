import { describe, expect, it } from "vitest";
import { applyUrlFor, boardFromHtml, boardGuesses, detectAts, fromPage, kindFor, parseAshby, parseGreenhouse, routeFor, withBasics } from "./scan";

describe("detectAts", () => {
  it("reads Greenhouse, Lever and Ashby URLs", () => {
    expect(detectAts("https://job-boards.greenhouse.io/attentive/jobs/4415182009")).toEqual({ ats: "greenhouse", board: "attentive", id: "4415182009" });
    expect(detectAts("https://boards.greenhouse.io/clear/jobs/8262132?gh_src=x")).toEqual({ ats: "greenhouse", board: "clear", id: "8262132" });
    expect(detectAts("https://boards.greenhouse.io/embed/job_app?for=via&token=8796174002")).toEqual({ ats: "greenhouse", board: "via", id: "8796174002" });
    expect(detectAts("https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-000000000000")).toMatchObject({ ats: "lever", site: "acme" });
    expect(detectAts("https://jobs.ashbyhq.com/Citizen/ec0690d5-be5e-4e8b-be78-d832f166b242")).toEqual({ ats: "ashby", org: "Citizen", id: "ec0690d5-be5e-4e8b-be78-d832f166b242" });
  });

  it("spots company pages that embed Greenhouse", () => {
    expect(detectAts("https://www.redventures.com/careers/positions/open?gh_jid=8008090")).toEqual({ ats: "greenhouse", board: "", id: "8008090" });
    expect(applyUrlFor(detectAts("https://www.redventures.com/careers/positions/open?gh_jid=8008090"), "https://www.redventures.com/careers/positions/open?gh_jid=8008090")).toBe(
      "https://www.redventures.com/careers/positions/open?gh_jid=8008090",
    );
    expect(boardFromHtml(`<script src="https://boards.greenhouse.io/embed/job_board/js?for=redventures"></script>`)).toBe("redventures");
    expect(boardFromHtml(`fetch("https://boards-api.greenhouse.io/v1/boards/acme_co/jobs")`)).toBe("acme_co");
    expect(boardFromHtml("<p>no board</p>")).toBeNull();
    expect(boardGuesses("careers.red-ventures.com")).toEqual(["red-ventures", "redventures"]);
  });

  it("names Workday and SmartRecruiters, and falls back to other", () => {
    expect(detectAts("https://citi.wd5.myworkdayjobs.com/en-US/2/job/123").ats).toBe("workday");
    expect(detectAts("https://jobs.smartrecruiters.com/Acme/7444").ats).toBe("smartrecruiters");
    expect(detectAts("https://careers.blackrock.com/job/new-york/director/45831/1").ats).toBe("other");
    expect(detectAts("not a url").ats).toBe("other");
  });

  it("builds the page a person applies on", () => {
    expect(applyUrlFor(detectAts("https://jobs.ashbyhq.com/archive/cb7678cf"), "x")).toBe("https://jobs.ashbyhq.com/archive/cb7678cf/application");
    expect(applyUrlFor({ ats: "other" }, "https://example.com/job")).toBe("https://example.com/job");
  });
});

describe("kindFor", () => {
  it("sorts fields, uploads and questions", () => {
    expect(kindFor("Resume/CV", "file")).toBe("resume");
    expect(kindFor("Cover Letter", "file")).toBe("cover_letter");
    expect(kindFor("LinkedIn Profile", "text")).toBe("field");
    expect(kindFor("First Name", "text")).toBe("field");
    expect(kindFor("Will you now or in the future require sponsorship?", "select")).toBe("answer");
    expect(kindFor("Website", "textarea")).toBe("answer");
  });

  it("keeps field labels with their usual extras as fields", () => {
    for (const l of ["Email Address", "Phone Number *", "LinkedIn Profile URL", "Current Location (City, State)", "Preferred First Name", "Name (first and last)", "Website or portfolio link", "Location:"]) expect(kindFor(l, "text"), l).toBe("field");
  });

  // Fields are approved without review, so these must reach the person (#579).
  it("treats questions that start with a field word as answers", () => {
    expect(kindFor("Location: are you open to relocating to New York?", "select")).toBe("answer");
    expect(kindFor("Email address of your referrer", "text")).toBe("answer");
    expect(kindFor("Name of the person who referred you", "text")).toBe("answer");
    expect(kindFor("Address any gaps in your employment history", "text")).toBe("answer");
    expect(kindFor("Phone number for a reference", "text")).toBe("answer");
  });
});

describe("parseGreenhouse", () => {
  // Trimmed from boards-api.greenhouse.io/v1/boards/attentive/jobs/4415182009?questions=true
  const job = {
    questions: [
      { label: "First Name", required: true, fields: [{ type: "input_text", values: [] }] },
      { label: "Resume/CV", required: true, fields: [{ type: "input_file" }, { type: "textarea" }] },
      { label: "Cover Letter", required: false, fields: [{ type: "input_file" }, { type: "textarea" }] },
      { label: "Will you now or in the future require sponsorship to work in the US?", required: true, fields: [{ type: "multi_value_single_select", values: [{ label: "Yes" }, { label: "No" }] }] },
      { label: "If \"YES\", what is the basis of your current employment authorization? ", required: false, fields: [{ type: "textarea" }] },
    ],
    location_questions: [
      { label: "Longitude", required: true, fields: [{ type: "input_hidden" }] },
      { label: "Latitude", required: true, fields: [{ type: "input_hidden" }] },
      { label: "Location", required: true, fields: [{ type: "input_text" }] },
    ],
    demographic_questions: { header: "Voluntary Self-Identification", questions: [] },
  };

  it("returns the full description with title, location and pay in front", () => {
    const r = parseGreenhouse({
      ...job,
      title: "Group AI Product Manager | Digital",
      location: { name: "New York, NY" },
      pay_input_ranges: [{ min_cents: 23000000, max_cents: 26000000, currency_type: "USD", title: "Total cash" }],
      content: "&lt;p&gt;Own the P&amp;amp;L.&lt;/p&gt;",
    });
    expect(r.postingHtml).toBe("<p>Title: Group AI Product Manager | Digital</p><p>Location: New York, NY</p><p>Total cash: $230,000 – $260,000 USD</p><p>Own the P&amp;L.</p>");
  });

  it("lists every question with kind, requiredness and options", () => {
    const r = parseGreenhouse(job);
    expect(r.items.map((i) => [i.kind, i.required])).toEqual([
      ["field", true],
      ["resume", true],
      ["cover_letter", false],
      ["answer", true],
      ["answer", false],
      ["field", true],
    ]);
    expect(r.items.map((i) => i.prompt)).not.toContain("Latitude");
    expect(r.items[3].options).toEqual(["Yes", "No"]);
    expect(r.items[4].prompt).toBe('If "YES", what is the basis of your current employment authorization?');
    expect(r.hasEeo).toBe(false);
  });
});

describe("parseAshby", () => {
  const res = {
    data: {
      jobPosting: {
        applicationForm: {
          sections: [
            {
              title: null,
              fieldEntries: [
                { isRequired: true, field: { type: "String", title: "Name" } },
                { isRequired: true, field: { type: "File", title: "Resume" } },
                { isRequired: false, field: { type: "LongText", title: "Additional information" } },
                { isRequired: true, field: { type: "Boolean", title: "Are you authorized to work in the US?" } },
              ],
            },
            { title: "U.S. Equal Employment Opportunity information", fieldEntries: [{ isRequired: false, field: { type: "ValueSelect", title: "Gender" } }] },
          ],
        },
      },
    },
  };

  it("maps Ashby types and skips the EEO section", () => {
    const r = parseAshby(res);
    expect(r.items.map((i) => [i.kind, i.prompt, i.fieldType])).toEqual([
      ["field", "Name", "text"],
      ["resume", "Resume", "file"],
      ["answer", "Additional information", "textarea"],
      ["answer", "Are you authorized to work in the US?", "select"],
    ]);
    expect(r.items.find((i) => i.kind === "eeo")).toBeUndefined();
    expect(r.items[3].options).toEqual(["Yes", "No"]);
    expect(r.hasEeo).toBe(true);
  });

  it("says so when the posting is gone", () => {
    expect(() => parseAshby({ data: { jobPosting: null } })).toThrow(/closed/);
  });
});

describe("fromPage and withBasics", () => {
  it("always has a resume and a cover letter, without duplicates", () => {
    const page = fromPage({
      hasForm: true,
      hasEeo: false,
      howToApply: "",
      items: [
        { prompt: "Email", required: true, fieldType: "text", options: [] },
        { prompt: "Why this role?", required: true, fieldType: "textarea", options: [] },
        { prompt: "Email", required: true, fieldType: "text", options: [] },
      ],
    });
    const items = withBasics(page.items);
    expect(items.map((i) => i.kind)).toEqual(["resume", "cover_letter", "field", "answer"]);
    expect(items[0].required).toBe(true);
    expect(items[1].required).toBe(false);
  });

  it("routes the big three to the browser worker and the rest to a checklist", () => {
    expect(routeFor("greenhouse")).toBe("browser");
    expect(routeFor("workday")).toBe("manual");
  });
});

import { greenhouseEeo } from "./scan";

describe("greenhouseEeo", () => {
  it("turns both Greenhouse EEO formats into voluntary eeo items", () => {
    const items = greenhouseEeo(
      { questions: [{ label: "Gender", type: "multi_value_single_select", answer_options: [{ label: "Female" }, { label: "Male" }, { label: "Decline to self-identify" }] }] },
      [{ type: "eeoc", questions: [{ label: "VeteranStatus", fields: [{ values: [{ label: "I am not a protected veteran" }, { label: "I don't wish to answer" }] }] }] }],
    );
    expect(items.map((i) => [i.kind, i.prompt, i.required, i.options?.length])).toEqual([
      ["eeo", "Gender", false, 3],
      ["eeo", "Veteran Status", false, 2],
    ]);
  });
});
