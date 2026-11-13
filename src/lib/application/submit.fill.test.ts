import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { ApplicationStatus } from "@/lib/db/schema";
import { CAPTCHA_STOP } from "./submitMode";

// An in-process Postgres with the real migrations, standing in for the app database.
const pg = new PGlite();
const db = drizzle(pg, { schema });
vi.mock("@/lib/db", () => ({ db, schema }));

/**
 * A fake application form in place of Chromium (#385). It answers the Playwright calls submit.ts
 * makes: controls found by label or role, a Submit button, and what the page shows after Submit.
 */
type El = { kind: "control" | "file" | "button" | "option" | "confirm" | "captcha" | "group" | "wrapper"; label: string; tag?: string; type?: string; role?: string; after?: boolean; options?: string[]; children?: El[] };
type Page = ReturnType<typeof fakePage>;

/** The full text content of an element: its own label plus all descendants' labels. */
function textOf(e: El): string {
  if (!e.children?.length) return e.label;
  return [e.label, ...e.children.flatMap((c) => textOf(c))].join(" ");
}

function fakePage(els: El[]) {
  const did: string[] = [];
  let submitted = false;
  /** All descendant elements, flat for discovery. */
  const allEls = (el: El): El[] => [el, ...(el.children ?? []).flatMap(allEls)];
  const shown = () => els.flatMap(allEls).filter((e) => !e.after || submitted);
  const loc = (find: () => El[]): Loc => {
    const one = () => {
      const e = find()[0];
      if (!e) throw new Error("element not found");
      return e;
    };
    return {
      first: () => loc(() => find().slice(0, 1)),
      last: () => loc(() => find().slice(-1)),
      nth: (i) => loc(() => find().slice(i, i + 1)),
      or: (o) => loc(() => [...find(), ...o.all()]),
      filter: ({ hasText, has }) => loc(() => find().filter((e) => (!hasText || textOf(e).includes(hasText)) && (!has || has.all().includes(e)))),
      locator: (sel) =>
        loc(() =>
          sel === "input[type=file]"
            ? find().filter((e) => e.kind === "file")
            : sel === "input:not([type=file]):not([type=hidden]),textarea,select"
              ? find().filter((e) => e.kind === "control")
              : sel === "input,textarea,select"
                ? find().filter((e) => e.kind === "control" || e.kind === "file")
                : sel === "option"
                  ? find().flatMap((e) => (e.options ?? []).map((o) => ({ kind: "option" as const, label: o })))
                  : sel === "input[type=radio]"
                    ? find().filter((e) => e.kind === "group" && e.type === "radio")
                    : [],
        ),
      // Inside a checkbox or radio group: one box per option, found by its exact label.
      getByLabel: (l) => loc(() => find().flatMap((g) => (g.kind === "group" && g.options?.includes(l) ? [{ kind: "control" as const, label: l, type: "checkbox" }] : []))),
      all: find,
      count: async () => find().length,
      isVisible: async () => find().length > 0,
      // Present: resolves now. Absent: fails a moment later, like a Playwright timeout.
      waitFor: () => (find().length ? Promise.resolve() : new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 20))),
      evaluate: async (fn) => {
        const e = one();
        return fn({ tagName: (e.tag ?? "input").toUpperCase(), getAttribute: (a) => (a === "type" ? (e.type ?? null) : a === "role" ? (e.role ?? null) : null) });
      },
      innerText: async () => one().label,
      allTextContents: async () => find().map((e) => e.label),
      click: async () => {
        const e = one();
        did.push(`click ${e.label}`);
        if (e.kind === "button" && /submit/i.test(e.label)) submitted = true;
      },
      fill: async (v) => void did.push(`fill ${one().label}=${v}`),
      press: async (k) => void did.push(`press ${one().label} ${k}`),
      check: async () => void did.push(`check ${one().label}`),
      uncheck: async () => void did.push(`uncheck ${one().label}`),
      selectOption: async ({ label }) => {
        const e = one();
        if (!e.options?.includes(label)) throw new Error(`no option ${label}`);
        did.push(`select ${e.label}=${label}`);
      },
      setInputFiles: async (f) => void did.push(`upload ${one().label}=${path.basename(f)}`),
    };
  };
  const byRole = (role: string, { name, exact }: { name: RegExp | string; exact?: boolean }) =>
    loc(() => shown().filter((e) => (e.role ?? (e.kind === "button" ? "button" : "")) === role && (name instanceof RegExp ? name.test(e.label) : exact ? e.label === name : e.label.includes(name))));
  const page = {
    did,
    setDefaultTimeout: () => {},
    goto: async (u: string) => void did.push(`goto ${u}`),
    url: () => "https://jobs.example.com/apply/thanks",
    screenshot: async ({ path: p }: { path: string }) => void did.push(`screenshot ${path.basename(p)}`),
    getByRole: byRole,
    // A [role=radiogroup] named by aria-labelledby is found by its label too.
    getByLabel: (label: string | RegExp) =>
      loc(() =>
        shown().filter(
          (e) => (e.kind === "control" || e.kind === "file" || e.role === "radiogroup") && (label instanceof RegExp ? label.test(e.label) : e.label.toLowerCase().includes(label.toLowerCase())),
        ),
      ),
    getByText: (re: RegExp) => loc(() => shown().filter((e) => e.kind === "confirm" && re.test(e.label))),
    locator: (sel: string) =>
      loc(() => {
        if (sel === "form input, form textarea") return shown().filter((e) => e.kind === "control" || e.kind === "file" || e.kind === "group");
        // The file box (":is(div,...)" with an upload inside) and the upload itself are the same element here.
        // A wrapper with children is also a container, for nested-DOM tests (#913).
        if (sel === "input[type=file]") return shown().filter((e) => e.kind === "file");
        if (sel.startsWith(":is(")) return shown().filter((e) => e.kind === "file" || e.kind === "wrapper");
        if (sel.startsWith("iframe")) return shown().filter((e) => e.kind === "captcha");
        // A checkbox or radio group and the boxes inside it are the same element here, like the file box.
        if (sel === "fieldset, [role=group], [role=radiogroup]" || sel === "input[type=checkbox], input[type=radio]") return shown().filter((e) => e.kind === "group" && e.role !== "radiogroup");
        return [];
      }),
  };
  return page;
}
type Loc = {
  first(): Loc;
  last(): Loc;
  nth(i: number): Loc;
  or(o: Loc): Loc;
  filter(f: { hasText?: string; has?: Loc }): Loc;
  locator(sel: string): Loc;
  getByLabel(l: string, o?: unknown): Loc;
  all(): El[];
  count(): Promise<number>;
  isVisible(): Promise<boolean>;
  waitFor(o?: unknown): Promise<unknown>;
  evaluate(fn: (e: { tagName: string; getAttribute: (a: string) => string | null }) => string): Promise<string>;
  innerText(): Promise<string>;
  allTextContents(): Promise<string[]>;
  click(): Promise<void>;
  fill(v: string): Promise<void>;
  press(k: string): Promise<void>;
  check(): Promise<void>;
  uncheck(): Promise<void>;
  selectOption(o: { label: string }): Promise<void>;
  setInputFiles(f: string): Promise<void>;
};

let page: Page;
const close = vi.fn(async () => {});
const launch = vi.fn(async () => ({ newContext: async () => ({ newPage: async () => page }), close }));
vi.mock("playwright-core", () => ({ chromium: { launch } }));

const { runFill, startFill } = await import("./submit");

let dataDir: string;
let userId: string;
let oppId: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  dataDir = await mkdtemp(path.join(os.tmpdir(), "lookout-fill-"));
});
afterAll(async () => {
  await pg.close();
  await rm(dataDir, { recursive: true, force: true });
});
beforeEach(async () => {
  launch.mockClear();
  close.mockClear();
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("APP_SECRET", "s".repeat(32));
  vi.stubEnv("APP_SECRET_PREVIOUS", "");
  await db.delete(schema.applications);
  await db.delete(schema.opportunities);
  await db.delete(schema.users);
  [{ id: userId }] = await db.insert(schema.users).values({ email: "me@example.com", name: "Pat Lee" }).returning();
  await db.insert(schema.profiles).values({ userId });
  const [search] = await db.insert(schema.searches).values({ userId, name: "Job search", answers: {} }).returning();
  [{ id: oppId }] = await db.insert(schema.opportunities).values({ company: "Acme, Inc.", title: "Design Director", fingerprint: "acme-dd" }).returning();
  await db.insert(schema.userOpportunities).values({ userId, searchId: search.id, opportunityId: oppId, score: 4 });
});

type ItemSeed = { kind: schema.ApplicationItemKind; prompt: string; content: string; options?: string[]; required?: boolean; fieldType?: string };

async function seed(status: ApplicationStatus, items: ItemSeed[]) {
  const [a] = await db.insert(schema.applications).values({ userId, opportunityId: oppId, status, route: "browser", report: { applyUrl: "https://jobs.example.com/apply" } }).returning();
  for (const [position, s] of items.entries()) {
    const [it] = await db.insert(schema.applicationItems).values({ applicationId: a.id, kind: s.kind, prompt: s.prompt, required: s.required ?? true, options: s.options, fieldType: s.fieldType, position }).returning();
    const [v] = await db.insert(schema.itemVersions).values({ itemId: it.id, version: 1, content: s.content, author: "ai" }).returning();
    await db.update(schema.applicationItems).set({ approvedVersionId: v.id }).where(eq(schema.applicationItems.id, it.id));
  }
  return a.id;
}

const app = async (id: string) => (await db.select().from(schema.applications).where(eq(schema.applications.id, id)))[0];
const stage = async () => (await db.select().from(schema.userOpportunities).where(eq(schema.userOpportunities.opportunityId, oppId)))[0].stage;
/** startFill runs in the background; wait until it has left "submitting". */
const settled = (id: string) =>
  vi.waitFor(async () => {
    const a = await app(id);
    if (a.status === "submitting" || !a.report.fill) throw new Error("still filling");
    return a;
  });

const ITEMS: ItemSeed[] = [
  { kind: "resume", prompt: "Resume", content: "# Pat Lee\npat@example.com\n\n## Experience\n### Design Lead, Beta Co\n- Led the design system." },
  { kind: "field", prompt: "Phone", content: "555-0100" },
  { kind: "field", prompt: "Are you authorized to work in the US?", content: "Yes", options: ["Yes", "No"] },
];
/** A Greenhouse-style form for ITEMS, behind an Apply button, with its phone Country picker. */
const FORM: El[] = [
  { kind: "button", label: "Apply now" },
  { kind: "file", label: "Resume", type: "file" },
  { kind: "control", label: "Phone", type: "tel" },
  { kind: "control", label: "Are you authorized to work in the US?", tag: "select", options: ["Yes", "No"] },
  { kind: "control", label: "Country", role: "combobox" },
  { kind: "option", label: "United States", role: "option" },
  { kind: "button", label: "Submit application" },
];
const THANKS: El = { kind: "confirm", label: "Thank you for applying to Acme!", after: true };

describe("runFill (#385)", () => {
  it("test: fills every field, picks the phone country and never clicks Submit", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage([...FORM, THANKS]);
    const r = await runFill(id, "test");
    expect(r.missing).toEqual([]);
    expect(r.stopped).toBeUndefined();
    expect(r.log.map((l) => [l.prompt, l.ok, l.how])).toEqual([
      ["Resume", true, "uploaded .docx"],
      ["Phone", true, "typed"],
      ["Are you authorized to work in the US?", true, "selected"],
      ["Phone country", true, "picked United States"],
    ]);
    expect(page.did).toContain("click Apply now");
    expect(page.did).toContain("upload Resume=Pat Lee - Acme Inc. Resume.docx");
    expect(page.did).toContain("fill Phone=555-0100");
    expect(page.did).toContain("select Are you authorized to work in the US?=Yes");
    expect(page.did).toContain("screenshot filled.png");
    expect(page.did).not.toContain("click Submit application");
    expect(close).toHaveBeenCalledOnce();
  });

  it("stops before Submit when a required field isn't on the page", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage([...FORM.filter((e) => e.label !== "Phone"), THANKS]);
    const r = await runFill(id, "submit");
    expect(r.missing).toEqual(["Phone"]);
    expect(r.stopped).toBe("Couldn't fill: Phone");
    expect(r.log.find((l) => l.prompt === "Phone")).toMatchObject({ ok: false, how: "field not found" });
    expect(page.did).not.toContain("click Submit application");
  });

  it("an optional field it can't fill doesn't stop the submit", async () => {
    const id = await seed("approved", [...ITEMS, { kind: "answer", prompt: "Anything else?", content: "No", required: false }]);
    page = fakePage([...FORM, THANKS]);
    const r = await runFill(id, "submit");
    expect(r.missing).toEqual([]);
    expect(r.confirmation).toBe("Thank you for applying to Acme!");
  });

  it("a select whose options don't include the answer counts as not filled", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Are you authorized to work in the US?", content: "Maybe", options: ["Maybe"] }]);
    page = fakePage(FORM);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: false, how: "option not in the list" });
    expect(r.stopped).toBe("Couldn't fill: Are you authorized to work in the US?");
  });

  it("a select takes the option the answer means, not only its exact text (#695)", async () => {
    const q = "Do you now or will you require sponsorship?";
    const id = await seed("approved", [
      { kind: "field", prompt: "Are you authorized to work in the US?", content: "Yes, I am authorized to work in the US" },
      { kind: "field", prompt: q, content: "No" },
    ]);
    page = fakePage([
      { kind: "control", label: "Are you authorized to work in the US?", tag: "select", options: ["Select...", "Yes", "No"] },
      { kind: "control", label: q, tag: "select", options: ["Select...", "None of the above", "No, I will not require sponsorship", "Yes"] },
    ]);
    const r = await runFill(id, "test");
    expect(r.log.map((l) => [l.ok, l.how])).toEqual([
      [true, "selected"],
      [true, "selected"],
    ]);
    expect(page.did).toContain("select Are you authorized to work in the US?=Yes");
    expect(page.did).toContain(`select ${q}=No, I will not require sponsorship`);
  });
});

describe("runFill controls (#567)", () => {
  const TOOLS = "Which tools do you use? Select any that apply.";
  const GROUP: El = { kind: "group", label: TOOLS, options: ["Figma", "Sketch", "Framer"] };
  const tools = (content: string, options = ["Figma", "Sketch", "Framer"]): ItemSeed => ({ kind: "answer", prompt: TOOLS, content, options });

  it("ticks each picked option in a checkbox group with no single labeled control (#165)", async () => {
    const id = await seed("approved", [tools("Figma\nFramer")]);
    page = fakePage([GROUP]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "checked 2" });
    expect(page.did).toEqual(expect.arrayContaining(["check Figma", "check Framer"]));
    expect(page.did).not.toContain("check Sketch");
  });

  it("stops when a picked option isn't in the group on the page", async () => {
    const id = await seed("approved", [tools("Figma\nAdobe XD", ["Figma", "Adobe XD"])]);
    page = fakePage([GROUP]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: false, how: "option not found: Adobe XD" });
    expect(r.missing).toEqual([TOOLS]);
  });

  it("stops when the answer matches none of the options", async () => {
    const id = await seed("approved", [tools("Pen and paper")]);
    page = fakePage([GROUP]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: false, how: "answer matches no option" });
    expect(page.did.some((d) => d.startsWith("check"))).toBe(false);
  });

  it("a text answer whose label isn't on the page is not found, even with a checkbox group there", async () => {
    const id = await seed("approved", [{ kind: "answer", prompt: TOOLS, content: "Figma" }]);
    page = fakePage([GROUP]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: false, how: "field not found" });
  });

  it("checks one radio in a fieldset question, the option the answer means (#694)", async () => {
    const q = "Will you now or in the future require sponsorship?";
    const id = await seed("approved", [{ kind: "field", prompt: q, content: "No, I will not\nYes", options: ["Yes", "No, I will not"] }]);
    page = fakePage([{ kind: "group", type: "radio", label: q, options: ["Yes", "No, I will not"] }]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "checked 1" });
    expect(page.did).toContain("check No, I will not");
    expect(page.did).not.toContain("check Yes");
    expect(r.missing).toEqual([]);
  });

  it("answers the group named by the question, not a later one whose question starts the same (#720)", async () => {
    const short = "Do you require sponsorship?";
    const long = "Do you require sponsorship? (now or in the future)";
    const id = await seed("approved", [{ kind: "field", prompt: short, content: "No", options: ["Yes", "No"] }]);
    page = fakePage([
      { kind: "group", type: "radio", role: "group", label: short, options: ["Yes", "No"] },
      { kind: "group", type: "radio", role: "group", label: long, options: ["Yes", "Nope"] },
    ]);
    const r = await runFill(id, "test");
    // The later group has no "No" box, so landing there would report "option not found".
    expect(r.log[0]).toMatchObject({ ok: true, how: "checked 1" });
    expect(page.did).toContain("check No");
  });

  it("answers the radio group named by the question, not a later \"If other\" box whose label holds it (#952)", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "How did you hear about us?", content: "LinkedIn", options: ["LinkedIn", "Other"] }]);
    page = fakePage([
      { kind: "group", type: "radio", role: "group", label: "How did you hear about us?", options: ["LinkedIn", "Other"] },
      { kind: "control", label: "If other, how did you hear about us?" },
    ]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "checked 1" });
    expect(page.did).toContain("check LinkedIn");
    expect(page.did.some((d) => d.startsWith("fill If other"))).toBe(false);
  });

  it("checks the radio the answer means when the radio itself is labeled with the question (#720)", async () => {
    const q = "Can you work onsite?";
    const id = await seed("approved", [{ kind: "field", prompt: q, content: "No", options: ["Yes", "No"] }]);
    page = fakePage([
      { kind: "control", type: "radio", role: "radio", label: `${q} Yes` },
      { kind: "control", type: "radio", role: "radio", label: `${q} No` },
    ]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "checked 1" });
    expect(page.did).toContain(`check ${q} No`);
    expect(page.did.some((d) => d.includes(`${q} Yes`))).toBe(false);
  });

  it("reports a question-labeled radio as not found when no radio is the meant option (#720)", async () => {
    const q = "Can you work onsite?";
    const id = await seed("approved", [{ kind: "field", prompt: q, content: "No", options: ["Yes", "No"] }]);
    page = fakePage([{ kind: "control", type: "radio", role: "radio", label: `${q} Yes` }]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: false, how: "option not found: No" });
    expect(page.did.some((d) => d.startsWith("click") || d.startsWith("check"))).toBe(false);
  });

  it("checks a radio in a [role=radiogroup] named by its label (#694)", async () => {
    const q = "Are you 18 or older?";
    const id = await seed("approved", [{ kind: "field", prompt: q, content: "Yes", options: ["Yes", "No"] }]);
    page = fakePage([{ kind: "group", type: "radio", role: "radiogroup", label: q, options: ["Yes", "No"] }]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "checked 1" });
    expect(page.did).toContain("check Yes");
    expect(page.did.some((d) => d.startsWith("click") || d.startsWith("fill") || d.startsWith("press"))).toBe(false);
  });

  it("ticks a single checkbox on any yes, and reports a required one it can't tick (#669)", async () => {
    const agree = "I agree to the privacy policy";
    const certify = "I certify the above is true";
    const relocate = "Willing to relocate";
    const terms = "I accept the terms";
    const id = await seed("approved", [
      { kind: "field", prompt: agree, content: "Yes, I agree" },
      { kind: "field", prompt: certify, content: "I certify" },
      { kind: "field", prompt: relocate, content: "No", required: false },
      { kind: "field", prompt: terms, content: "No" },
    ]);
    page = fakePage([
      { kind: "control", label: agree, type: "checkbox" },
      { kind: "control", label: certify, type: "checkbox" },
      { kind: "control", label: relocate, type: "checkbox" },
      { kind: "control", label: terms, type: "checkbox" },
    ]);
    const r = await runFill(id, "test");
    expect(r.log.map((l) => [l.ok, l.how])).toEqual([
      [true, "checked"],
      [true, "checked"],
      [true, "left unchecked"],
      [false, "answer is not a yes"],
    ]);
    expect(page.did).toContain(`check ${agree}`);
    expect(page.did).toContain(`check ${certify}`);
    expect(page.did).not.toContain(`check ${relocate}`);
    // Unticked even if the site ticked it ahead (#788).
    expect(page.did).toContain(`uncheck ${relocate}`);
    expect(page.did).not.toContain(`check ${terms}`);
    expect(r.missing).toEqual([terms]);
  });

  it("opens a custom dropdown, types the answer and clicks the exact option", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Location", content: "New York, NY" }]);
    page = fakePage([
      { kind: "control", label: "Location", role: "combobox" },
      { kind: "option", label: "New York, NY, USA", role: "option" },
      { kind: "option", label: "New York, NY", role: "option" },
    ]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "picked option" });
    expect(page.did).toEqual(["goto https://jobs.example.com/apply", "click Location", "fill Location=New York, NY", "click New York, NY", "screenshot filled.png"]);
  });

  it("presses Enter in a choice field when no exact option shows", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "How did you hear about us?", content: "LinkedIn", options: ["LinkedIn", "Referral"] }]);
    page = fakePage([{ kind: "control", label: "How did you hear about us?" }]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "picked option" });
    expect(page.did).toContain("press How did you hear about us? Enter");
  });

  it("a custom dropdown types and clicks the option the answer means, not the whole answer (#700)", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Are you authorized to work in the US?", content: "Yes, I am authorized to work in the US", options: ["Yes", "No"] }]);
    page = fakePage([
      { kind: "control", label: "Are you authorized to work in the US?", role: "combobox" },
      { kind: "option", label: "Yes", role: "option" },
      { kind: "option", label: "No", role: "option" },
    ]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: true, how: "picked option" });
    expect(page.did).toEqual(["goto https://jobs.example.com/apply", "click Are you authorized to work in the US?", "fill Are you authorized to work in the US?=Yes", "click Yes", "screenshot filled.png"]);
  });

  it("logs the phone country as not filled when United States isn't listed, without stopping", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    page = fakePage([
      { kind: "control", label: "Phone", type: "tel" },
      { kind: "control", label: "Country", role: "combobox" },
      { kind: "option", label: "United States Minor Outlying Islands", role: "option" },
    ]);
    const r = await runFill(id, "test");
    expect(r.log.at(-1)).toEqual({ prompt: "Phone country", ok: false, how: "United States not in the list" });
    expect(r.missing).toEqual([]);
    expect(r.stopped).toBeUndefined();
  });

  it("leaves the phone country alone when the form asks Country as its own question", async () => {
    const id = await seed("approved", [
      { kind: "field", prompt: "Phone", content: "555-0100" },
      { kind: "field", prompt: "Country", content: "Canada" },
    ]);
    page = fakePage([
      { kind: "control", label: "Phone", type: "tel" },
      { kind: "control", label: "Country", role: "combobox" },
      { kind: "option", label: "Canada", role: "option" },
      { kind: "option", label: "United States", role: "option" },
    ]);
    const r = await runFill(id, "test");
    expect(r.log.map((l) => l.prompt)).toEqual(["Phone", "Country"]);
    expect(page.did).toContain("click Canada");
    expect(page.did).not.toContain("click United States");
  });

  it("an upload with nothing to upload counts as not filled", async () => {
    const id = await seed("approved", [{ kind: "answer", prompt: "Portfolio", content: "", fieldType: "file" }]);
    page = fakePage([{ kind: "file", label: "Portfolio", type: "file" }]);
    const r = await runFill(id, "test");
    expect(r.log[0]).toMatchObject({ ok: false, how: "no file" });
    expect(r.missing).toEqual(["Portfolio"]);
  });

  describe("cover letter upload (#860)", () => {
    const LETTER: ItemSeed = { kind: "cover_letter", prompt: "Cover Letter", content: "Dear Acme team,\n\nI lead design systems.\n\nPat Lee" };
    const RESUME = ITEMS[0];
    const uploads = () => page.did.filter((d) => d.startsWith("upload "));

    it("goes in its own upload box", async () => {
      const id = await seed("approved", [RESUME, LETTER]);
      page = fakePage([{ kind: "file", label: "Resume", type: "file" }, { kind: "file", label: "Cover Letter", type: "file" }]);
      const r = await runFill(id, "test");
      expect(r.missing).toEqual([]);
      expect(uploads()).toEqual(["upload Resume=Pat Lee - Acme Inc. Resume.docx", "upload Cover Letter=Pat Lee - Acme Inc. Cover Letter.docx"]);
    });

    it("is typed into a cover letter text box, and never replaces the resume upload", async () => {
      const id = await seed("approved", [RESUME, LETTER]);
      page = fakePage([{ kind: "file", label: "Resume", type: "file" }, { kind: "control", label: "Cover Letter", tag: "textarea" }]);
      const r = await runFill(id, "test");
      expect(r.missing).toEqual([]);
      expect(r.log.find((l) => l.prompt === "Cover Letter")).toMatchObject({ ok: true, how: "typed the letter" });
      expect(uploads()).toEqual(["upload Resume=Pat Lee - Acme Inc. Resume.docx"]);
      expect(page.did).toContain(`fill Cover Letter=${LETTER.content}`);
    });

    it("takes the second upload when no box names it", async () => {
      const id = await seed("approved", [RESUME, LETTER]);
      page = fakePage([{ kind: "file", label: "Resume", type: "file" }, { kind: "file", label: "Other documents", type: "file" }]);
      await runFill(id, "test");
      expect(uploads()).toEqual(["upload Resume=Pat Lee - Acme Inc. Resume.docx", "upload Other documents=Pat Lee - Acme Inc. Cover Letter.docx"]);
    });

    it("with nowhere to go, counts as not filled instead of taking the resume's upload", async () => {
      const id = await seed("approved", [RESUME, LETTER]);
      page = fakePage([{ kind: "file", label: "Resume", type: "file" }]);
      const r = await runFill(id, "test");
      expect(r.log.find((l) => l.prompt === "Cover Letter")).toMatchObject({ ok: false, how: "upload field not found" });
      expect(r.missing).toEqual(["Cover Letter"]);
      expect(uploads()).toEqual(["upload Resume=Pat Lee - Acme Inc. Resume.docx"]);
    });

    it("does not take the resume input when cover letter text is in the same wrapper (#913)", async () => {
      const id = await seed("approved", [RESUME, LETTER]);
      // A shared wrapper: the resume file input and "A cover letter is optional." text in the same container.
      page = fakePage([
        { kind: "wrapper", label: "", children: [
          { kind: "file", label: "Resume/CV", type: "file" },
          { kind: "control", label: "A cover letter is optional.", tag: "span" },
        ]},
      ]);
      const r = await runFill(id, "test");
      // The cover letter should NOT take the resume input. It has no upload box of its own and no text box
      // labeled "Cover Letter", so it reports not found.
      expect(r.log.find((l) => l.prompt === "Cover Letter")).toMatchObject({ ok: false, how: "upload field not found" });
      expect(r.missing).toEqual(["Cover Letter"]);
      // Resume upload is unaffected.
      expect(uploads()).toEqual(["upload Resume/CV=Pat Lee - Acme Inc. Resume.docx"]);
    });
  });

  it("fills the field labeled with the question before one whose label only contains it (#698)", async () => {
    const id = await seed("approved", [
      { kind: "field", prompt: "Website", content: "https://pat.design" },
      { kind: "field", prompt: "Email", content: "pat@example.com" },
      { kind: "field", prompt: "Portfolio", content: "https://pat.design/work" },
    ]);
    page = fakePage([
      { kind: "control", label: "Portfolio Website" },
      { kind: "control", label: "Website" },
      { kind: "control", label: "Email me about future openings", type: "checkbox" },
      { kind: "control", label: "Email *", type: "email" },
      { kind: "control", label: "Portfolio Website (optional)" },
    ]);
    const r = await runFill(id, "test");
    expect(r.log.map((l) => [l.prompt, l.ok, l.how])).toEqual([
      ["Website", true, "typed"],
      ["Email", true, "typed"],
      ["Portfolio", true, "typed"],
    ]);
    expect(page.did).toEqual(expect.arrayContaining(["fill Website=https://pat.design", "fill Email *=pat@example.com", "fill Portfolio Website=https://pat.design/work"]));
  });

  it("fills the form straight away when there's no Apply button", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    page = fakePage([{ kind: "control", label: "Phone", type: "tel" }]);
    const r = await runFill(id, "test");
    expect(r.log).toEqual([{ prompt: "Phone", ok: true, how: "typed" }]);
    expect(page.did.some((d) => d.startsWith("click"))).toBe(false);
  });
});

describe("startFill test (#923)", () => {
  it("a test fill that finishes after a submit keeps the submit's record", async () => {
    const id = await seed("manual", ITEMS);
    const submitted = { mode: "submit" as const, at: "2026-11-13T09:00:00.000Z", log: [], missing: [], clicked: true, stopped: "Lookout clicked Submit but didn't see a confirmation." };
    const before = new Date("2026-11-13T09:00:00.000Z");
    await db.update(schema.applications).set({ report: { applyUrl: "https://jobs.example.com/apply", fill: submitted }, updatedAt: before }).where(eq(schema.applications.id, id));
    page = fakePage(FORM);
    await startFill(id, "test");
    const a = await vi.waitFor(async () => {
      const a = await app(id);
      if (a.updatedAt.getTime() === before.getTime()) throw new Error("still filling");
      return a;
    });
    expect(a.report.fill).toEqual(submitted);
  });

  it("a test fill with no submit before it records its result", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage(FORM);
    await startFill(id, "test");
    const a = await settled(id);
    expect(a.report.fill?.mode).toBe("test");
  });
});

describe("startFill submit (#385)", () => {
  it("a confirmation on the page records it submitted, with what was sent, and moves the find to Applied", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage([...FORM, THANKS]);
    await startFill(id, "submit");
    const a = await settled(id);
    expect(page.did).toContain("click Submit application");
    expect(page.did).toContain("screenshot after-submit.png");
    expect(a.status).toBe("submitted");
    expect(a.submittedAt).not.toBeNull();
    expect(a.confirmation).toMatchObject({ how: "browser", applyUrl: "https://jobs.example.com/apply", url: "https://jobs.example.com/apply/thanks", text: "Thank you for applying to Acme!" });
    expect((a.confirmation?.sent as { prompt: string }[]).map((s) => s.prompt)).toEqual(["Resume", "Phone", "Are you authorized to work in the US?"]);
    expect(await stage()).toBe("Applied");
  });

  it("a CAPTCHA after Submit ends in manual and says so", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage([...FORM, { kind: "captcha", label: "recaptcha challenge", after: true }]);
    await startFill(id, "submit");
    const a = await settled(id);
    expect(a.status).toBe("manual");
    expect(a.submittedAt).toBeNull();
    expect(a.report.fill).toMatchObject({ stopped: CAPTCHA_STOP, captcha: true });
    expect(await stage()).toBe("Not applied");
  });

  it("posting text that reads like a confirmation doesn't count when Submit shows nothing new (#784)", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage([...FORM, { kind: "confirm", label: "Once your application has been received, a recruiter will reach out." }]);
    await startFill(id, "submit");
    const a = await settled(id);
    expect(a.status).toBe("manual");
    expect(a.report.fill?.stopped).toMatch(/didn't see a confirmation/);
    expect(a.report.fill?.clicked).toBe(true);
    expect(await stage()).toBe("Not applied");
  });

  it("with that posting text on the page, the confirmation after Submit is the one recorded (#784)", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage([...FORM, { kind: "confirm", label: "Once your application has been received, a recruiter will reach out." }, THANKS]);
    await startFill(id, "submit");
    const a = await settled(id);
    expect(a.status).toBe("submitted");
    expect(a.confirmation).toMatchObject({ text: "Thank you for applying to Acme!" });
  });

  it("no confirmation after Submit ends in manual with a warning not to send twice", async () => {
    const id = await seed("approved", ITEMS);
    page = fakePage(FORM);
    await startFill(id, "submit");
    const a = await settled(id);
    expect(a.status).toBe("manual");
    expect(a.report.fill?.stopped).toMatch(/didn't see a confirmation/);
    expect(a.report.fill?.finalUrl).toBe("https://jobs.example.com/apply/thanks");
    expect(await stage()).toBe("Not applied");
  });
});
