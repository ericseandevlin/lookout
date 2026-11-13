// Staging load test (#989): made-up accounts, their searches in one go, and the numbers.
// Runs inside the STAGING app container only:
//   docker compose exec app node scripts/loadtest.mjs seed 50
//   docker compose exec app node scripts/loadtest.mjs run [--concurrency 1] [--limit 50]
//   docker compose exec app node scripts/loadtest.mjs report [--since <ISO time>]
//   docker compose exec app node scripts/loadtest.mjs cleanup
// Accounts are loadtest-NN@loadtest.invalid (.invalid never receives mail). `run` starts each account's
// "Search now" over HTTP inside the container, waits for it, and samples memory and CPU every 5 seconds.
// Concurrency 1 matches the scheduler (one search at a time). Searches cost real AI money and hit SearXNG.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const DOMAIN = "loadtest.invalid";
const NAME = "Load test";
const app = process.env.APP_URL || "";
if (!/staging/.test(app) && process.env.LOADTEST_ANY_APP !== "1") {
  console.error(`APP_URL is ${app || "(unset)"}: this only runs on staging. Refusing.`);
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 3 });
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : dflt;
};

// --- made-up profiles -------------------------------------------------------------

const ROLES = [
  ["Senior Product Designer", "Lead design for a consumer app, owning the design system", 150000, 185000, "Redesigned checkout and lifted conversion 12%"],
  ["Staff Software Engineer", "Tech lead on a platform team at a product company", 190000, 240000, "Cut API latency 60% by rebuilding the caching layer"],
  ["Director of Events", "Run events at a flagship venue, owning sales and production", 130000, 165000, "Grew private event revenue 38% in two years"],
  ["Registered Nurse, ICU", "Charge nurse role in a teaching hospital ICU", 95000, 120000, "Led the unit's sepsis protocol rollout, cutting response time by a third"],
  ["Data Analyst", "Senior analyst owning a team's metrics and dashboards", 85000, 110000, "Built the weekly revenue dashboard leadership runs the business on"],
  ["Marketing Manager", "Own lifecycle and email marketing for a B2C brand", 105000, 135000, "Grew email revenue 25% with a new onboarding series"],
  ["Product Manager", "Senior PM owning a growth area at a SaaS company", 160000, 200000, "Shipped self-serve signup that added 4,000 paying teams"],
  ["Accountant, CPA", "Senior accountant or controller track at a mid-size firm", 90000, 120000, "Closed the books in 5 days instead of 12"],
  ["Operations Manager", "Run operations for a warehouse or distribution center", 95000, 125000, "Cut order errors in half across two shifts"],
  ["Elementary School Teacher", "Lead teacher, grades 2 to 4, at a well-run school", 60000, 80000, "Raised reading scores 20 points in one year"],
];
const PLACES = [
  ["Remote", "United States"],
  ["Hybrid", "New York City"],
  ["On-site", "Chicago"],
  ["Hybrid", "Austin, Texas"],
  ["Remote", "Denver, Colorado"],
];
const OFF = ["No relocation", "No more than 20% travel", "No contract roles", "No early-stage startups", "No nights or weekends"];

function profile(i) {
  const [title, step, floor, target, win] = ROLES[i % ROLES.length];
  const [mode, area] = PLACES[Math.floor(i / ROLES.length) % PLACES.length];
  return {
    name: `${NAME} ${String(i + 1).padStart(2, "0")}`,
    email: `loadtest-${String(i + 1).padStart(2, "0")}@${DOMAIN}`,
    answers: { q1: `${title}. ${step}`, floor: String(floor), target: String(target), modes: [mode], area, q4: win, q5: OFF[i % OFF.length] },
    resume:
      `${title} with 8 years of experience. ${win}. Looking for: ${step.toLowerCase()}. ` +
      `Based in ${area}, open to ${mode.toLowerCase()} work. (Made-up account for a load test.)`,
  };
}

async function loadtestUsers() {
  return sql`select id, email from users where email like ${"%@" + DOMAIN} order by email`;
}

// --- seed / cleanup ---------------------------------------------------------------

async function seed(n) {
  if (!(n > 0 && n <= 200)) throw new Error("usage: seed <1-200>");
  let made = 0;
  for (let i = 0; i < n; i++) {
    const p = profile(i);
    const [have] = await sql`select id from users where lower(email) = ${p.email}`;
    if (have) continue;
    await sql.begin(async (tx) => {
      const [u] = await tx`insert into users (email, name, onboarded_at) values (${p.email}, ${p.name}, now()) returning id`;
      const [s] = await tx`insert into searches (user_id, name, kind, answers, saved_at)
        values (${u.id}, 'Job search', 'job', ${tx.json(p.answers)}, now()) returning id`;
      // Daily, no digest email, auto-apply off (the default).
      await tx`insert into settings (user_id, active_search_id, freq, digest) values (${u.id}, ${s.id}, 'Daily', false)`;
      await tx`insert into profiles (user_id) values (${u.id})`;
      await tx`insert into materials (user_id, kind, file_name, mime, status, scanned_at, extracted)
        values (${u.id}, 'resume', 'resume.pdf', 'application/pdf', 'done', now(), ${tx.json({ text: p.resume })})`;
    });
    made++;
  }
  console.log(`Seeded ${made} new accounts (${(await loadtestUsers()).length} load-test accounts in total).`);
}

async function cleanup() {
  await sql`delete from rate_limits where key in (select 'run-now:' || id::text from users where email like ${"%@" + DOMAIN})`;
  const r = await sql`delete from users where email like ${"%@" + DOMAIN} returning id`;
  console.log(`Deleted ${r.length} load-test accounts (their searches, finds, runs and sessions go with them).`);
}

// --- sampling ---------------------------------------------------------------------

const read = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};
const num = (s) => (s.trim() === "" || s.trim() === "max" ? null : Number(s.trim()));
function sample() {
  const mem = num(read("/sys/fs/cgroup/memory.current"));
  const cpu = Number(/usage_usec (\d+)/.exec(read("/sys/fs/cgroup/cpu.stat"))?.[1] ?? NaN);
  const avail = Number(/MemAvailable:\s+(\d+)/.exec(read("/proc/meminfo"))?.[1] ?? NaN) * 1024;
  const load = Number(read("/proc/loadavg").split(" ")[0]);
  return { t: Date.now(), mem, cpu, avail, load };
}

// --- SearXNG health -----------------------------------------------------------------

async function probeSearx(q = "software engineer jobs remote") {
  const u = new URL("/search", process.env.SEARXNG_URL || "http://searxng:8080");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  const t = Date.now();
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, status: res.status, ms: Date.now() - t, results: 0, blocked: [] };
    const d = await res.json();
    return { ok: true, status: res.status, ms: Date.now() - t, results: (d.results ?? []).length, blocked: (d.unresponsive_engines ?? []).map((e) => e.join(": ")) };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t, results: 0, blocked: [], error: String(e?.message ?? e) };
  }
}

// --- run ----------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(userId) {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await sql`insert into sessions (id_hash, user_id, expires_at, user_agent) values (${hash}, ${userId}, now() + interval '1 day', 'loadtest')`;
  return token;
}

async function searchNow(user) {
  const token = await session(user.id);
  const res = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/runs`, {
    method: "POST",
    headers: { cookie: `lookout_session=${token}`, origin: app.replace(/\/$/, ""), "content-type": "application/json" },
    body: "{}",
  });
  if (res.status !== 202) return { started: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  // Wait for the run to finish (the app fails runs older than 45 minutes on its own).
  const t0 = Date.now();
  while (Date.now() - t0 < 50 * 60_000) {
    await sleep(5000);
    const [r] = await sql`select status from runs where user_id = ${user.id} and trigger = 'manual' order by started_at desc limit 1`;
    if (r && r.status !== "running" && r.status !== "queued") return { started: true };
  }
  return { started: true, error: "still running after 50 minutes" };
}

async function run() {
  const conc = Math.max(1, Number(flag("concurrency", "1")));
  const users = (await loadtestUsers()).slice(0, Number(flag("limit", "1000")));
  if (!users.length) throw new Error("No load-test accounts. Run seed first.");
  const since = new Date();
  console.log(`Start ${since.toISOString()}: ${users.length} searches, ${conc} at a time.`);
  const probes = [{ at: "before", ...(await probeSearx()) }];
  const samples = [sample()];
  const timer = setInterval(() => samples.push(sample()), 5000);
  const startErrors = [];
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < users.length) {
      const u = users[next++];
      const r = await searchNow(u);
      done++;
      if (r.error) startErrors.push(`${u.email}: ${r.error}`);
      process.stdout.write(`  ${done}/${users.length} ${u.email}${r.error ? "  " + r.error : ""}\n`);
      if (done % 10 === 0) probes.push({ at: `after ${done}`, ...(await probeSearx()) });
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  clearInterval(timer);
  samples.push(sample());
  probes.push({ at: "after", ...(await probeSearx()) });
  await report(since, { samples, probes, startErrors, conc });
}

// --- report -------------------------------------------------------------------------

const pct = (xs, p) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0);
const mb = (b) => (b == null || Number.isNaN(b) ? "n/a" : `${Math.round(b / 1048576)} MB`);
const mins = (ms) => `${(ms / 60000).toFixed(1)} min`;

async function report(since, extra = {}) {
  const runs = await sql`
    select r.status, r.error, r.started_at, r.finished_at, r.found, r.added, r.searches, r.cost_usd, r.input_tokens, r.output_tokens,
           coalesce((r.report->>'results')::int, 0) as results, u.email
    from runs r join users u on u.id = r.user_id
    where u.email like ${"%@" + DOMAIN} and r.trigger in ('manual','scheduled') and r.started_at >= ${since}
    order by r.started_at`;
  if (!runs.length) return console.log(`No load-test runs since ${since.toISOString()}.`);
  const dur = runs.filter((r) => r.finished_at).map((r) => r.finished_at - r.started_at);
  const first = Math.min(...runs.map((r) => +r.started_at));
  const last = Math.max(...runs.map((r) => +(r.finished_at ?? r.started_at)));
  const failed = runs.filter((r) => r.status === "failed");
  const errors = {};
  for (const r of failed) errors[r.error ?? "?"] = (errors[r.error ?? "?"] ?? 0) + 1;
  const cost = runs.reduce((s, r) => s + Number(r.cost_usd), 0);
  const q = runs.reduce((s, r) => s + r.searches, 0);
  const lines = [
    `## Load test: ${runs.length} searches (#989)`,
    "",
    `- Window: ${new Date(first).toISOString()} to ${new Date(last).toISOString()} (${mins(last - first)} total${extra.conc ? `, ${extra.conc} at a time` : ""})`,
    `- One search: median ${mins(pct(dur, 50))}, p95 ${mins(pct(dur, 95))}, longest ${mins(Math.max(0, ...dur))}`,
    `- Failed: ${failed.length} of ${runs.length}${failed.length ? ": " + Object.entries(errors).map(([e, n]) => `${n}x ${e}`).join("; ") : ""}`,
    `- Did not start: ${extra.startErrors?.length ?? "n/a"}${extra.startErrors?.length ? ": " + extra.startErrors.slice(0, 5).join("; ") : ""}`,
    `- Web searches: ${q} queries; ${runs.filter((r) => r.status === "done" && r.results === 0).length} searches got zero results`,
    `- Finds: ${runs.reduce((s, r) => s + r.added, 0)} added from ${runs.reduce((s, r) => s + r.found, 0)} postings`,
    `- AI cost (app's estimate): $${cost.toFixed(3)} total, $${(cost / runs.length).toFixed(4)} a search; tokens ${runs.reduce((s, r) => s + r.input_tokens, 0)} in, ${runs.reduce((s, r) => s + r.output_tokens, 0)} out`,
  ];
  if (extra.probes) {
    lines.push("", "SearXNG probes (same query each time):");
    for (const p of extra.probes) lines.push(`- ${p.at}: ${p.ok ? `${p.results} results in ${p.ms} ms` : `FAILED ${p.status} ${p.error ?? ""}`}${p.blocked.length ? `; unresponsive: ${p.blocked.join(", ")}` : ""}`);
  }
  if (extra.samples?.length > 1) {
    const s = extra.samples;
    const cpuSec = (s.at(-1).cpu - s[0].cpu) / 1e6;
    const wall = (s.at(-1).t - s[0].t) / 1000;
    let peakCpu = 0;
    for (let i = 1; i < s.length; i++) peakCpu = Math.max(peakCpu, (s[i].cpu - s[i - 1].cpu) / 1e4 / ((s[i].t - s[i - 1].t) / 1000));
    lines.push(
      "",
      "Server (sampled every 5 s):",
      `- App container memory: start ${mb(s[0].mem)}, peak ${mb(Math.max(...s.map((x) => x.mem ?? 0)))} (limit 1 GB)`,
      `- App container CPU: average ${((cpuSec / wall) * 100).toFixed(0)}% of one core, peak ${peakCpu.toFixed(0)}%`,
      `- Server memory available: lowest ${mb(Math.min(...s.map((x) => x.avail)))} of 16 GB; load average peak ${Math.max(...s.map((x) => x.load)).toFixed(2)} (4 vCPU)`,
    );
  }
  console.log(lines.join("\n"));
}

// --- main ---------------------------------------------------------------------------

try {
  if (cmd === "seed") await seed(Number(rest[0]));
  else if (cmd === "run") await run();
  else if (cmd === "report") await report(new Date(flag("since", new Date(Date.now() - 864e5).toISOString())));
  else if (cmd === "cleanup") await cleanup();
  else {
    console.error("usage: loadtest.mjs seed <n> | run [--concurrency 1] [--limit n] | report [--since ISO] | cleanup");
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
