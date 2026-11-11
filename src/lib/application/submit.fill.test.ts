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
type El = { kind: "control" | "file" | "button" | "option" | "confirm" | "captcha" | "group"; label: string; tag?: string; type?: string; role?: string; after?: boolean; options?: string[] };
type Page = ReturnType<typeof fakePage>;

function fakePage(els: El[]) {
  const did: string[] = [];
  let submitted = false;
  const shown = () => els.filter((e) => !e.after || submitted);
  const loc = (find: () => El[]): Loc => {
    const one = () => {
      const e = find()[0];
      if (!e) throw new Error("element not found");
      return e;
    };
    return {
      first: () => loc(() => find().slice(0, 1)),
      last: () => loc(() => find().slice(-1)),
      or: (o) => loc(() => [...find(), ...o.all()]),
      filter: ({ hasText, has }) => loc(() => find().filter((e) => (!hasText || e.label.includes(hasText)) && (!has || has.all().includes(e)))),
      locator: (sel) =>
        loc(() =>
          sel === "input[type=file]" ? find().filter((e) => e.kind === "file") : sel === "option" ? find().flatMap((e) => (e.options ?? []).map((o) => ({ kind: "option" as const, label: o }))) : [],
        ),
      // Inside a checkbox group: one checkbox per option, found by its exact label.
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
    getByLabel: (label: string) => loc(() => shown().filter((e) => (e.kind === "control" || e.kind === "file") && e.label.toLowerCase().includes(label.toLowerCase()))),
    getByText: (re: RegExp) => loc(() => shown().filter((e) => e.kind === "confirm" && re.test(e.label))),
    locator: (sel: string) =>
      loc(() => {
        if (sel === "form input, form textarea") return shown().filter((e) => e.kind === "control" || e.kind === "file" || e.kind === "group");
        // The file box (":is(div,...)" with an upload inside) and the upload itself are the same element here.
        if (sel === "input[type=file]" || sel.startsWith(":is(")) return shown().filter((e) => e.kind === "file");
        if (sel.startsWith("iframe")) return shown().filter((e) => e.kind === "captcha");
        // A checkbox group and the checkboxes inside it are the same element here, like the file box.
        if (sel === "fieldset, [role=group]" || sel === "input[type=checkbox]") return shown().filter((e) => e.kind === "group");
        return [];
      }),
  };
  return page;
}
type Loc = {
  first(): Loc;
  last(): Loc;
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

  it("fills the form straight away when there's no Apply button", async () => {
    const id = await seed("approved", [{ kind: "field", prompt: "Phone", content: "555-0100" }]);
    page = fakePage([{ kind: "control", label: "Phone", type: "tel" }]);
    const r = await runFill(id, "test");
    expect(r.log).toEqual([{ prompt: "Phone", ok: true, how: "typed" }]);
    expect(page.did.some((d) => d.startsWith("click"))).toBe(false);
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
