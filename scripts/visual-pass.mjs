// Visual pass (#1217): a full-page screenshot of every signed-in page at phone and desktop width, for a person to
// review spacing, type and states side by side. Run by .github/workflows/visual-pass.yml against a fresh compose.yaml
// stack seeded with the demo account, signed in as an admin so the admin pages are included.
//   node scripts/visual-pass.mjs --base <url> --link <sign-in link> [--out <dir>]
// Needs Chrome (CHROME_PATH, or the installed "chrome" channel). Writes <out>/<width>/<nn>-<page>.png.
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const { values: opt } = parseArgs({ options: { base: { type: "string" }, link: { type: "string" }, out: { type: "string", default: "visual-pass" } } });
if (!opt.base || !opt.link?.includes("/auth/verify?token=")) {
  console.error("usage: node scripts/visual-pass.mjs --base <url> --link <sign-in link> [--out <dir>]");
  process.exit(1);
}
const base = new URL(opt.base).origin;
const out = resolve(opt.out);
const WIDTHS = [375, 1280];
const PAGES = [
  ["finds", "/finds"],
  ["events", "/events"],
  ["profile", "/profile"],
  ["profile-sees", "/profile/sees"],
  ["profile-materials", "/profile/materials"],
  ["profile-application", "/profile/application"],
  ["apply", "/apply"],
  ["settings", "/settings"],
  ["next", "/next"],
  ["admin", "/admin"],
  ["admin-activity", "/admin/activity"],
  ["admin-ai", "/admin/ai"],
  ["admin-errors", "/admin/errors"],
  ["admin-metrics", "/admin/metrics"],
  ["admin-quality", "/admin/quality"],
  ["admin-surveys", "/admin/surveys"],
];

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const settle = async () => {
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
  };

  await page.goto(opt.link, { waitUntil: "domcontentloaded" });
  const agree = page.getByRole("checkbox");
  if (await agree.count()) await agree.first().check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/finds", { timeout: 30_000 });

  for (const width of WIDTHS) {
    const dir = join(out, String(width));
    mkdirSync(dir, { recursive: true });
    await page.setViewportSize({ width, height: width < 760 ? 812 : 860 });
    let n = 0;
    const shot = async (name) => {
      await settle();
      const file = `${String(++n).padStart(2, "0")}-${name}.png`;
      await page.screenshot({ path: join(dir, file), fullPage: true });
      console.log(`${width}/${file}  ${page.url().slice(base.length)}`);
    };
    for (const [name, path] of PAGES) {
      const res = await page.goto(base + path, { waitUntil: "domcontentloaded" }).catch(() => null);
      if (!res || res.status() >= 400) {
        console.log(`${width} ${path}: ${res?.status() ?? "no answer"}, skipped`);
        continue;
      }
      await shot(name);
      if (name === "finds") {
        // The drawer, opened from the first find: a table row on desktop, a card on a phone.
        const first = page.getByRole("button", { name: / at / }).filter({ visible: true }).first();
        if (await first.count()) {
          await first.click();
          await page.getByRole("dialog").first().waitFor();
          await shot("finds-drawer");
          await page.keyboard.press("Escape");
        }
      }
    }
  }
} finally {
  await browser.close();
}
