// Flow check (#996): walk the main flows in docs/flows.md in a real browser and report broken links, failed requests,
// script errors, dead ends and steps that do not say what happens next. It reports; it changes nothing on its own.
// Run weekly by .github/workflows/flow-check.yml against a fresh compose.yaml stack seeded with the demo account.
//
//   node scripts/flow-check.mjs --base <url> [--link <sign-in link>] [--submit] [--out <dir>]
//
// --link   a one-time sign-in link (scripts/login-link.mjs) for an account that finished the welcome step. Without it
//          only the signed-out pages are walked.
// --submit also fills and sends the sign-in and request-access forms. Only for a throwaway stack: it adds a waitlist row.
// Writes <out>/report.md, <out>/report.json and <out>/pages/<step>.md + .png (text and screenshot of every step).
// Needs Chrome (CHROME_PATH, or the installed "chrome" channel). Exits 1 only if the walk itself breaks.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { checkLinks, checkPage, formatReport } from "./flow-check-rules.mjs";

const { values: opt } = parseArgs({
  options: { base: { type: "string" }, link: { type: "string" }, submit: { type: "boolean", default: false }, out: { type: "string", default: "flow-check" } },
});
if (!opt.base || (opt.link && !opt.link.includes("/auth/verify?token="))) {
  console.error("usage: node scripts/flow-check.mjs --base <url> [--link <sign-in link>] [--submit] [--out <dir>]");
  process.exit(1);
}
const base = new URL(opt.base).origin;
const out = resolve(opt.out);
mkdirSync(join(out, "pages"), { recursive: true });
const startedAt = new Date().toISOString();

// Links the check never follows: they sign you out, spend a one-time token or leave the browser.
const SKIP_LINK = /\/(auth\/verify|api\/auth\/|signout|logout|unsubscribe)|^(mailto|tel|javascript):/i;

const pages = [];
const findings = [];
const linkFrom = new Map(); // url -> steps that link to it

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  let consoleErrors = [];
  let failedRequests = [];
  // "Failed to load resource" repeats a failed request, which is reported on its own.
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));
  page.on("response", (r) => {
    // Our own requests only: a third-party widget failing is not a Lookout bug.
    // The page's own document is not counted here; its status is checked as the page's.
    const doc = r.request().isNavigationRequest() && r.frame() === page.mainFrame();
    if (r.status() >= 400 && r.url().startsWith(base) && !doc) failedRequests.push({ url: r.url().slice(base.length), status: r.status() });
  });
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "failed";
    // A navigation or prefetch cut short by the next one shows as ERR_ABORTED; that is normal.
    if (r.url().startsWith(base) && !why.includes("ERR_ABORTED")) failedRequests.push({ url: r.url().slice(base.length), error: why });
  });

  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(400);
  };

  /** Record the current page (or the open dialog) as one step. */
  async function snap(step, { status, expectStatus, expectText, scope } = {}) {
    await settle();
    const seen = await page.evaluate((scopeSel) => {
      const root = (scopeSel && document.querySelector(scopeSel)) || document.querySelector("main, [role=main]") || document.body;
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
      const nameOf = (el) =>
        el.getAttribute("aria-label") ||
        (el.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim() ||
        el.innerText ||
        el.getAttribute("title") ||
        el.querySelector("img[alt]")?.getAttribute("alt") ||
        el.value ||
        "";
      const actions = [...root.querySelectorAll('a[href], button, [role=button], input[type=submit], input[type=button]')]
        .filter(visible)
        .map((el) => ({
          role: el.tagName === "A" ? "link" : "button",
          name: nameOf(el).replace(/\s+/g, " ").trim().slice(0, 120),
          href: el.tagName === "A" ? el.href : undefined,
          disabled: !!(el.disabled || el.getAttribute("aria-disabled") === "true"),
        }));
      const allLinks = [...document.querySelectorAll("a[href]")].map((a) => a.href);
      const headings = [...root.querySelectorAll("h1, h2")].filter(visible).map((h) => h.innerText.trim()).filter(Boolean);
      return { title: document.title, headings, actions, allLinks, text: root.innerText };
    }, scope ?? null);
    const url = page.url();
    // The sign-in token is spent by now, but it still stays out of the report.
    const path = (url.startsWith(base) ? url.slice(base.length) || "/" : url).replace(/token=[^&]+/, "token=...");
    const record = { step, url, path, status, expectStatus, expectText, ...seen, consoleErrors, failedRequests };
    findings.push(...checkPage(record));
    for (const href of seen.allLinks) {
      const clean = href.split("#")[0];
      if (!clean || SKIP_LINK.test(clean) || !/^https?:/.test(clean)) continue;
      linkFrom.set(clean, [...new Set([...(linkFrom.get(clean) ?? []), step])]);
    }
    const file = String(pages.length + 1).padStart(2, "0") + "-" + step.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    await page.screenshot({ path: join(out, "pages", `${file}.png`), fullPage: true });
    writeFileSync(
      join(out, "pages", `${file}.md`),
      [
        `# ${step}`,
        "",
        `Address: ${path}  `,
        `Title: ${seen.title}  `,
        `Headings: ${seen.headings.join(" / ") || "none"}`,
        "",
        "## What you can press",
        "",
        ...seen.actions.map((a) => `- ${a.role}: ${a.name || "(no name)"}${a.disabled ? " (disabled)" : ""}${a.href ? ` -> ${a.href.startsWith(base) ? a.href.slice(base.length) : a.href}` : ""}`),
        "",
        "## Text",
        "",
        seen.text.slice(0, 6000),
        "",
      ].join("\n"),
    );
    pages.push({ step, path, status, file });
    console.log(`${step}: ${path} ${status ?? ""}`);
    consoleErrors = [];
    failedRequests = [];
  }

  /** Open a page and record it. ifLinked: only when an earlier page links to it (it may be off for this account). */
  async function visit(step, path, { ifLinked, ...extra } = {}) {
    if (ifLinked && !linkFrom.has(base + path)) return console.log(`${step}: ${path} not linked for this account, skipped`);
    consoleErrors = [];
    failedRequests = [];
    const res = await page.goto(base + path, { waitUntil: "domcontentloaded" }).catch((e) => {
      findings.push({ kind: "page-error", step, url: base + path, detail: String(e.message).split("\n")[0] });
      return null;
    });
    if (!res) return;
    // A page that redirects to one already walked (e.g. /materials) adds nothing new.
    const landed = page.url().slice(base.length) || "/";
    if (landed !== path && pages.some((p) => p.path === landed)) return console.log(`${step}: ${path} -> ${landed}, already walked`);
    await snap(step, { status: res.status(), ...extra });
  }

  // Flow 1, getting in, signed out.
  await visit("Landing page", "/");
  await visit("Request access", "/request-access");
  const send = page.getByRole("button", { name: "Request access" }).last();
  if (opt.submit && (await send.count())) {
    await page.getByLabel(/email/i).first().fill(`flow-check+${Date.now()}@example.com`);
    await send.click();
    await snap("Request access, sent", { expectText: ["approved"] });
  }
  await visit("Sign in", "/signin");
  // With sign-in email off the page has no button; it says so instead, and that is checked like any page.
  const emailMe = page.getByRole("button", { name: /sign-in link/i });
  if (opt.submit && (await emailMe.count())) {
    await page.getByLabel(/email/i).first().fill("nobody@example.com");
    await emailMe.click();
    await snap("Sign in, link sent", { expectText: ["inbox"] });
  }
  await visit("Group link that does not exist", "/join/flowcheck0", { expectText: ["doesn't work"] });
  await visit("Terms", "/terms");
  await visit("Privacy", "/privacy");

  if (opt.link) {
    // Flow 1, the sign-in link. The account must have finished the welcome step, so it lands on the board.
    consoleErrors = [];
    failedRequests = [];
    const res = await page.goto(opt.link, { waitUntil: "domcontentloaded" });
    await snap("Sign-in link", { status: res?.status() });
    const agree = page.getByRole("checkbox");
    if (await agree.count()) await agree.first().check();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForURL("**/finds", { timeout: 30_000 });

    // Flow 4, the board, and one find opened.
    await snap("Board", { status: 200 });
    // The row's title button reads "<role> at <company>"; Pin, Archive and the stage come before and after it.
    const firstFind = page.locator('[role="row"]').nth(1).getByRole("button", { name: / at / }).first();
    if (await firstFind.count()) {
      await firstFind.click();
      await page.getByRole("dialog").first().waitFor();
      await snap("A find, opened", { status: 200, scope: '[role="dialog"]' });
      await page.keyboard.press("Escape");
    } else findings.push({ kind: "dead-end", step: "Board", url: base + "/finds", detail: "The board has no find to open." });

    // Flow 2, the search profile, and the rest of the signed-in pages.
    await visit("Profile", "/profile");
    await visit("What Lookout sees", "/profile/sees");
    await visit("Profile materials", "/profile/materials");
    await visit("Application answers", "/profile/application", { ifLinked: true });
    // Flow 5, auto-apply. A beta, so a person without it may see a "not on" page; that page should still say so.
    await visit("Auto-apply", "/apply", { ifLinked: true });
    await visit("Materials", "/materials", { ifLinked: true });
    await visit("Settings", "/settings");
    await visit("Activity", "/events", { ifLinked: true });
    await visit("What's next", "/next", { ifLinked: true });
  }

  // Every link seen on the way, each asked once. A redirect is fine; an error or no answer is a broken link.
  const links = [];
  for (const [url, from] of linkFrom) {
    const ext = !url.startsWith(base);
    const r = await context.request.get(url, { timeout: ext ? 10_000 : 20_000, maxRedirects: 5, failOnStatusCode: false }).catch((e) => ({ error: String(e.message).split("\n")[0] }));
    // External sites often refuse robots with 403 or 429; only a missing page or no answer counts there.
    const status = r.status?.();
    if (ext && status && ![404, 410].includes(status)) continue;
    links.push({ url: ext ? url : url.slice(base.length) || "/", status, error: r.error, from });
  }
  findings.push(...checkLinks(links));

  const report = formatReport({ base, startedAt, pages, findings, signedIn: !!opt.link });
  writeFileSync(join(out, "report.md"), report);
  writeFileSync(join(out, "report.json"), JSON.stringify({ base, startedAt, pages, findings, linksChecked: linkFrom.size }, null, 2));
  console.log(`\n${report}`);
} finally {
  await browser.close();
}
