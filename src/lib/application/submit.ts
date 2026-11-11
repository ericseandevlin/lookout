import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { draftToDocx } from "./docx";
import { checksBox, pickOne, pickOptions, planFill, type FillStep } from "./fillPlan";
import { letterHeaderFrom, type Template } from "./resumeLayout";
import { getAutoApplySettings } from "@/lib/apply";
import { resolve } from "./eeo";
import { loadEeo } from "./eeoStore";
import { autoSubmitOn, CAPTCHA_STOP } from "./submitMode";
import { patchReport } from "./reportStore";
import { statusAfterFill } from "./flowRules";

/**
 * Auto-apply step 5, browser half (#42): fill the real form with the approved versions in headless
 * Chromium. "test" fills and screenshots but never submits. "submit" clicks Submit, and only runs
 * after the user pressed Submit for me on a fully approved packet. Anything unexpected (a captcha,
 * a required field we couldn't fill, a page error) stops before submitting and falls back to the
 * manual checklist, with the reason.
 */

export const canAutoSubmit = autoSubmitOn;
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser";
export const shotDir = (appId: string) => path.resolve(env.dataDir, "apply", appId);

type Log = { prompt: string; ok: boolean; how: string }[];

export type FillReport = { mode: "test" | "submit"; at: string; log: Log; missing: string[]; stopped?: string; captcha?: boolean; confirmation?: string; finalUrl?: string };

async function loadPacket(appId: string) {
  const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
  const items = await db.select().from(schema.applicationItems).where(eq(schema.applicationItems.applicationId, appId)).orderBy(asc(schema.applicationItems.position));
  const ids = items.map((i) => i.approvedVersionId).filter((v): v is string => !!v);
  const versions = ids.length ? await db.select().from(schema.itemVersions).where(inArray(schema.itemVersions.id, ids)) : [];
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, a.userId));
  const [o] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.id, a.opportunityId));
  return { a, items, versions, user: u, opp: o };
}

/** Write the resume and cover letter as .docx for upload. */
async function files(appId: string, steps: FillStep[], name: string, company: string, template?: Template, accent?: string) {
  const dir = shotDir(appId);
  await mkdir(dir, { recursive: true });
  for (const s of steps) {
    if (s.kind !== "file" || !s.content) continue;
    const label = s.itemKind === "cover_letter" ? "Cover Letter" : "Resume";
    const file = path.join(dir, `${`${name} - ${company} ${label}`.replace(/[^\w .-]/g, "").trim() || label}.docx`);
    const letterHeader = s.itemKind === "cover_letter" ? letterHeaderFrom(steps.find((x) => x.itemKind === "resume")?.content, name) : undefined;
    await writeFile(file, await draftToDocx(s.content, label, { letterHeader, template, accent }));
    s.file = file;
  }
}

/** Everything a form needs, in form order, with the Word files written to disk. Shared by the browser worker and the Firefox extension (#169). */
export async function preparePacket(appId: string) {
  const { a, items, versions, user, opp } = await loadPacket(appId);
  const steps = planFill(items, versions);
  // Voluntary EEO questions: from the encrypted profile, only with consent, matched in code (#122).
  if (items.some((i) => i.kind === "eeo")) {
    const { consent, profile } = await loadEeo(a.userId);
    if (consent)
      for (const i of items.filter((x) => x.kind === "eeo")) {
        const answer = resolve(profile, i.prompt, i.options);
        if (answer) steps.push({ prompt: i.prompt, required: false, itemKind: "eeo", kind: "choice", content: answer });
      }
  }
  const look = await getAutoApplySettings(a.userId);
  await files(appId, steps, user?.name || "Resume", opp?.company ?? "", look.template, look.accent);
  return { a, steps, opp };
}

export async function runFill(appId: string, mode: "test" | "submit"): Promise<FillReport> {
  const { a, steps } = await preparePacket(appId);
  const report: FillReport = { mode, at: new Date().toISOString(), log: [], missing: [] };
  const url = a.report.applyUrl;
  if (!url) throw new Error("No application page to open");

  const { chromium } = await import("playwright-core");
  // The app container is read-only except /tmp; Chromium writes its profile, config and crash files under HOME.
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    env: { ...process.env, HOME: "/tmp", XDG_CONFIG_HOME: "/tmp/.config", XDG_CACHE_HOME: "/tmp/.cache" },
  });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: "en-US" })).newPage();
    page.setDefaultTimeout(8000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Some boards show the posting with an Apply button that reveals the form.
    const apply = page.getByRole("button", { name: /^apply( for this job| now)?$/i }).or(page.getByRole("link", { name: /^apply( for this job| now)?$/i }));
    if (await apply.first().isVisible().catch(() => false)) await apply.first().click().catch(() => {});
    await page.locator("form input, form textarea").first().waitFor({ timeout: 15000 });

    for (const s of steps) {
      const r = await fillOne(page, s);
      report.log.push({ prompt: s.prompt, ok: r.ok, how: s.itemKind === "eeo" ? (r.ok ? "filled from your EEO answers" : "couldn't fill") : r.how });
      if (!r.ok && s.required) report.missing.push(s.prompt);
    }
    const phone = steps.find((s) => /^phone\b/i.test(s.prompt));
    if (phone && !steps.some((s) => /^country\b/i.test(s.prompt))) {
      const r = await phoneCountry(page);
      if (r) report.log.push({ prompt: "Phone country", ok: r.ok, how: r.how });
    }
    const dir = shotDir(appId);
    await page.screenshot({ path: path.join(dir, "filled.png"), fullPage: true });

    if (report.missing.length) {
      report.stopped = `Couldn't fill: ${report.missing.join("; ")}`;
      return report;
    }
    if (mode === "test") return report;

    const submit = page.getByRole("button", { name: /submit( application)?|send application|apply/i }).last();
    await submit.click();
    const outcome = await Promise.race([
      page.getByText(/thank you|application (has been )?(received|submitted)|we('ve| have) received/i).first().waitFor({ timeout: 25000 }).then(() => "done" as const),
      page.locator("iframe[src*='recaptcha'][title*='challenge'], iframe[src*='hcaptcha'], iframe[title*='captcha' i]").first().waitFor({ state: "visible", timeout: 25000 }).then(() => "captcha" as const),
    ]).catch(() => "unknown" as const);
    await page.screenshot({ path: path.join(dir, "after-submit.png"), fullPage: true });
    report.finalUrl = page.url();
    if (outcome === "captcha") {
      report.stopped = CAPTCHA_STOP;
      report.captcha = true;
    }
    else if (outcome === "unknown") report.stopped = "Lookout clicked Submit but didn't see a confirmation. Check the screenshot and your email before sending again.";
    else report.confirmation = (await page.getByText(/thank you|application (has been )?(received|submitted)|we('ve| have) received/i).first().innerText().catch(() => "")).slice(0, 300);
    return report;
  } finally {
    await browser.close();
  }
}

type Page = import("playwright-core").Page;

/**
 * Greenhouse's phone input carries its own required "Country" picker that isn't one of the API questions (#167).
 * Pick United States. Returns null when the page has no such picker.
 */
async function phoneCountry(page: Page): Promise<{ ok: boolean; how: string } | null> {
  const box = page.getByRole("combobox", { name: /^country\*?$/i }).first();
  if (!(await box.count())) return null;
  try {
    await box.click();
    await box.fill("United States").catch(() => {});
    const opt = page.getByRole("option", { name: /^United States(?!\s+Minor)/ }).first();
    if (!(await opt.isVisible().catch(() => false))) return { ok: false, how: "United States not in the list" };
    await opt.click();
    return { ok: true, how: "picked United States" };
  } catch (e) {
    return { ok: false, how: e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : "error" };
  }
}

/** Find the control for one question by its label and put the approved answer in. */
async function fillOne(page: Page, s: FillStep): Promise<{ ok: boolean; how: string }> {
  try {
    if (s.kind === "file") {
      const box = page.locator(":is(div,fieldset,section,li)").filter({ hasText: s.prompt }).filter({ has: page.locator("input[type=file]") }).last();
      const input = (await box.count()) ? box.locator("input[type=file]").first() : page.locator("input[type=file]").first();
      if (!s.file) return { ok: false, how: "no file" };
      await input.setInputFiles(s.file);
      return { ok: true, how: "uploaded .docx" };
    }
    const field = page.getByLabel(s.prompt, { exact: false }).first();
    if (!(await field.count())) {
      // "Select any that apply" is a group of checkboxes under one legend, with no single labeled control (#165).
      const group = page.locator("fieldset, [role=group]").filter({ hasText: s.prompt.slice(0, 60) }).filter({ has: page.locator("input[type=checkbox]") }).last();
      if (s.kind !== "choice" || !(await group.count())) return { ok: false, how: "field not found" };
      const picks = pickOptions(s.content, s.options);
      if (!picks.length) return { ok: false, how: "answer matches no option" };
      for (const label of picks) {
        const box = group.getByLabel(label, { exact: true }).first();
        if (!(await box.count())) return { ok: false, how: `option not found: ${label.slice(0, 60)}` };
        await box.check();
      }
      return { ok: true, how: `checked ${picks.length}` };
    }
    const tag = await field.evaluate((e) => `${e.tagName.toLowerCase()}:${e.getAttribute("type") ?? ""}:${e.getAttribute("role") ?? ""}`);
    if (tag.startsWith("select")) {
      // The option the answer means, not only its exact text: "Yes, I am authorized" is the "Yes" option (#695).
      const labels = (await field.locator("option").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
      const i = pickOne(s.content, labels);
      if (i < 0) return { ok: false, how: "option not in the list" };
      await field.selectOption({ label: labels[i] });
      return { ok: true, how: "selected" };
    }
    if (tag.includes(":checkbox:")) {
      // A required box the answer doesn't tick is reported missing, not filled (#669).
      if (!checksBox(s.content)) return s.required ? { ok: false, how: "answer is not a yes" } : { ok: true, how: "left unchecked" };
      await field.check();
      return { ok: true, how: "checked" };
    }
    if (tag.includes("combobox") || s.kind === "choice") {
      // Custom dropdowns (react-select on Greenhouse, Ashby's own): open, type, pick the exact option.
      await field.click();
      await field.fill(s.content).catch(() => {});
      const opt = page.getByRole("option", { name: s.content, exact: true }).first();
      if (await opt.isVisible().catch(() => false)) await opt.click();
      else await field.press("Enter");
      return { ok: true, how: "picked option" };
    }
    await field.fill(s.content);
    return { ok: true, how: "typed" };
  } catch (e) {
    return { ok: false, how: e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : "error" };
  }
}

/**
 * Run a test fill or a real submit in the background and record the result on the application.
 * A submit first claims the approved application; returns false when it isn't approved (another request is already sending it, #615).
 */
export async function startFill(appId: string, mode: "test" | "submit"): Promise<boolean> {
  if (mode === "submit") {
    const claimed = await db
      .update(schema.applications)
      .set({ status: "submitting", updatedAt: new Date() })
      .where(and(eq(schema.applications.id, appId), eq(schema.applications.status, "approved")))
      .returning({ id: schema.applications.id });
    if (!claimed.length) return false;
  }
  void (async () => {
    let fill: FillReport;
    try {
      fill = await runFill(appId, mode);
    } catch (e) {
      fill = { mode, at: new Date().toISOString(), log: [], missing: [], stopped: e instanceof Error ? e.message.split("\n")[0] : "Something went wrong" };
    }
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
    if (!a) return;
    if (mode === "test") {
      await patchReport(appId, (r) => ({ ...r, fill }), { updatedAt: new Date() });
      return;
    }
    const report = { ...a.report, fill };
    if (statusAfterFill(fill) === "submitted") {
      const { sentRecord } = await import("./review");
      // Read before the transaction: a query on `db` inside it needs a second connection while the first is held.
      const sent = await sentRecord(appId);
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(schema.applications)
          .set({ status: "submitted", submittedAt: now, updatedAt: now, report, confirmation: { how: "browser", at: now.toISOString(), applyUrl: a.report.applyUrl ?? null, url: fill.finalUrl, text: fill.confirmation, sent } })
          .where(eq(schema.applications.id, appId));
        await tx
          .update(schema.userOpportunities)
          .set({ stage: "Applied" })
          .where(and(eq(schema.userOpportunities.userId, a.userId), eq(schema.userOpportunities.opportunityId, a.opportunityId)));
      });
    } else {
      await db.update(schema.applications).set({ status: "manual", report, updatedAt: new Date() }).where(eq(schema.applications.id, appId));
    }
  })().catch((e) => console.error("[apply] fill", e));
  return true;
}
