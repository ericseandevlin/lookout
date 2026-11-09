// Redraw the README images from the made-up demo account (#534): finds-board.png, find-detail.png and hero.gif.
// Run by .github/workflows/screenshots.yml against a fresh compose.yaml stack seeded with `npm run seed:demo`.
//   node scripts/screenshots.mjs <sign-in link from scripts/login-link.mjs> [out dir, default docs/screenshots]
// Needs Chrome (CHROME_PATH, or the installed "chrome" channel) and ffmpeg on PATH for the GIF.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const [link, outArg = "docs/screenshots"] = process.argv.slice(2);
if (!link || !link.includes("/auth/verify?token=")) {
  console.error("usage: node scripts/screenshots.mjs <sign-in link> [out dir]");
  process.exit(1);
}
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const WIDTH = 1440;
const HEIGHT = 900;
const FPS = 12;

// Headless Chrome draws no pointer, so the GIF gets a dot that follows the mouse.
const CURSOR = `addEventListener("DOMContentLoaded", () => {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;left:-40px;top:-40px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(29,26,15,.35);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);pointer-events:none;z-index:99999;transition:transform .12s";
  document.body.append(d);
  addEventListener("mousemove", (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; }, true);
  addEventListener("mousedown", () => { d.style.transform = "scale(.7)"; }, true);
  addEventListener("mouseup", () => { d.style.transform = ""; }, true);
});`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" });
try {
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const settle = async (ms = 900) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(ms);
  };

  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL("**/finds");
  const rows = page.locator('[role="row"]');
  await rows.nth(8).waitFor(); // header + the eight demo finds
  const firstFind = page.getByRole("button", { name: "Director of Events at Harbor Hall" });
  const drawer = page.getByRole("dialog", { name: "Director of Events at Harbor Hall" });
  await settle();

  // 1. The board, before anything is opened, so the New dots show.
  await page.screenshot({ path: join(out, "finds-board.png") });
  console.log("saved finds-board.png");

  // 2. The GIF: board, open a find, close it. Frames are screenshots taken as fast as they come, then timed by ffmpeg.
  await page.addInitScript(CURSOR);
  await page.reload();
  await rows.nth(8).waitFor();
  await settle();
  await page.mouse.move(WIDTH - 220, HEIGHT - 120);
  const frames = mkdtempSync(join(tmpdir(), "lookout-gif-"));
  const shots = [];
  let recording = true;
  const recorder = (async () => {
    while (recording) {
      const file = join(frames, `f${String(shots.length).padStart(4, "0")}.png`);
      await page.screenshot({ path: file });
      shots.push({ file, at: Date.now() });
    }
  })();
  const moveTo = async (locator, steps = 18) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error("nothing to move to");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  };
  try {
    await page.waitForTimeout(1400);
    await moveTo(firstFind);
    await page.waitForTimeout(350);
    await page.mouse.down();
    await page.mouse.up();
    await drawer.waitFor();
    await page.waitForTimeout(2600);
    // exact, or "Closed" in the stage picker matches too
    await moveTo(drawer.getByRole("button", { name: "Close", exact: true }));
    await page.waitForTimeout(350);
    await page.mouse.down();
    await page.mouse.up();
    await drawer.waitFor({ state: "detached" });
    await page.waitForTimeout(1400);
  } finally {
    recording = false;
    await recorder;
  }
  shots.push({ ...shots.at(-1), at: Date.now() });

  // Each frame lasts until the next one; the concat demuxer wants the last file listed twice.
  const list = shots
    .slice(0, -1)
    .map((s, i) => `file '${s.file}'\nduration ${((shots[i + 1].at - s.at) / 1000).toFixed(3)}`)
    .concat(`file '${shots.at(-1).file}'`)
    .join("\n");
  writeFileSync(join(frames, "list.txt"), list + "\n");
  const palette = `fps=${FPS},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", join(frames, "list.txt"), "-vf", palette, "-loop", "0", join(out, "hero.gif")], { stdio: "inherit" });
  rmSync(frames, { recursive: true, force: true });
  console.log(`saved hero.gif (${shots.length - 1} frames)`);

  // 3. A find opened, without the cursor dot.
  await page.close();
  const still = await context.newPage();
  await still.goto(new URL("/finds", link).href);
  await still.getByRole("button", { name: "Director of Events at Harbor Hall" }).click();
  await still.getByRole("dialog", { name: "Director of Events at Harbor Hall" }).waitFor();
  await still.mouse.move(WIDTH - 10, HEIGHT - 10);
  await still.evaluate(() => document.fonts.ready);
  await still.waitForTimeout(900);
  await still.screenshot({ path: join(out, "find-detail.png") });
  console.log("saved find-detail.png");
} finally {
  await browser.close();
}
