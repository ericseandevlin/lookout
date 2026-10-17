import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { draftToDocx } from "./docx";
import { planFill, type FillStep } from "./fillPlan";

/**
 * Auto-apply step 5, browser half (#42): fill the real form with the approved versions in headless
 * Chromium. "test" fills and screenshots but never submits. "submit" clicks Submit, and only runs
 * after the user pressed Submit for me on a fully approved packet. Anything unexpected (a captcha,
 * a required field we couldn't fill, a page error) stops before submitting and falls back to the
 * manual checklist, with the reason.
 */

export const canAutoSubmit = () => process.env.FEATURE_AUTO_SUBMIT === "on";
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium-browser";
export const shotDir = (appId: string) => path.resolve(env.dataDir, "apply", appId);

type Log = { prompt: string; ok: boolean; how: string }[];

export type FillReport = { mode: "test" | "submit"; at: string; log: Log; missing: string[]; stopped?: string; confirmation?: string; finalUrl?: string };

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
async function files(appId: string, steps: FillStep[], name: string, company: string) {
  const dir = shotDir(appId);
  await mkdir(dir, { recursive: true });
  for (const s of steps) {
    if (s.kind !== "file" || !s.content) continue;
    const label = s.itemKind === "cover_letter" ? "Cover Letter" : "Resume";
    const file = path.join(dir, `${`${name} - ${company} ${label}`.replace(/[^\w .-]/g, "").trim() || label}.docx`);
    await writeFile(file, await draftToDocx(s.content, label));
    s.file = file;
  }
}

export async function runFill(appId: string, mode: "test" | "submit"): Promise<FillReport> {
  const { a, items, versions, user, opp } = await loadPacket(appId);
  const report: FillReport = { mode, at: new Date().toISOString(), log: [], missing: [] };
  const steps = planFill(items, versions);
  await files(appId, steps, user?.name || "Resume", opp?.company ?? "");
  const url = a.report.applyUrl;
  if (!url) throw new Error("No application page to open");

  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
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
      report.log.push({ prompt: s.prompt, ok: r.ok, how: r.how });
      if (!r.ok && s.required) report.missing.push(s.prompt);
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
    if (outcome === "captcha") report.stopped = "The site asked for a captcha, so Lookout stopped. Finish it with the checklist.";
    else if (outcome === "unknown") report.stopped = "Lookout clicked Submit but didn't see a confirmation. Check the screenshot and your email before sending again.";
    else report.confirmation = (await page.getByText(/thank you|application (has been )?(received|submitted)|we('ve| have) received/i).first().innerText().catch(() => "")).slice(0, 300);
    return report;
  } finally {
    await browser.close();
  }
}

type Page = import("playwright-core").Page;

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
    if (!(await field.count())) return { ok: false, how: "field not found" };
    const tag = await field.evaluate((e) => `${e.tagName.toLowerCase()}:${e.getAttribute("type") ?? ""}:${e.getAttribute("role") ?? ""}`);
    if (tag.startsWith("select")) {
      await field.selectOption({ label: s.content });
      return { ok: true, how: "selected" };
    }
    if (tag.includes(":checkbox:")) {
      if (/^(yes|true|i agree|agree)$/i.test(s.content)) await field.check();
      return { ok: true, how: "checkbox" };
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

/** Run a test fill or a real submit in the background and record the result on the application. */
export async function startFill(appId: string, mode: "test" | "submit") {
  if (mode === "submit") await db.update(schema.applications).set({ status: "submitting", updatedAt: new Date() }).where(and(eq(schema.applications.id, appId), eq(schema.applications.status, "approved")));
  void (async () => {
    let fill: FillReport;
    try {
      fill = await runFill(appId, mode);
    } catch (e) {
      fill = { mode, at: new Date().toISOString(), log: [], missing: [], stopped: e instanceof Error ? e.message.split("\n")[0] : "Something went wrong" };
    }
    const [a] = await db.select().from(schema.applications).where(eq(schema.applications.id, appId));
    if (!a) return;
    const report = { ...a.report, fill };
    if (mode === "test") {
      await db.update(schema.applications).set({ report, updatedAt: new Date() }).where(eq(schema.applications.id, appId));
      return;
    }
    if (fill.confirmation !== undefined && !fill.stopped) {
      const { sentRecord } = await import("./review");
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(schema.applications)
          .set({ status: "submitted", submittedAt: now, updatedAt: now, report, confirmation: { how: "browser", at: now.toISOString(), applyUrl: a.report.applyUrl ?? null, url: fill.finalUrl, text: fill.confirmation, sent: await sentRecord(appId) } })
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
}
