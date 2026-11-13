// Rules for the flow check (#996): turn what the walker saw on each page into findings, and findings into a short
// report. Plain functions with no browser, so scripts/flow-check-rules.test.ts can cover them.

/** Labels that do not say what happens when you press them. Compared lowercased, without trailing punctuation. */
export const VAGUE_LABELS = new Set(["click here", "here", "link", "more", "read more", "learn more", "submit", "go", "button", "this"]);

const KIND = {
  "page-error": { title: "Page answers with an error", severity: "high" },
  "script-error": { title: "Page throws a script error", severity: "high" },
  "failed-request": { title: "A request from the page fails", severity: "high" },
  "broken-link": { title: "Link goes nowhere", severity: "high" },
  "expect-missing": { title: "Step does not say what happens next", severity: "medium" },
  "dead-end": { title: "Dead end: nothing to do next", severity: "medium" },
  "no-heading": { title: "Page has no heading", severity: "low" },
  "unnamed-control": { title: "Control with no name", severity: "medium" },
  "vague-label": { title: "Control label does not say what it does", severity: "low" },
};
const ORDER = { high: 0, medium: 1, low: 2 };

function label(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

/**
 * Findings for one page snapshot.
 * snap: { step, url, status, expectStatus?, headings[], actions[{ role, name, href?, disabled? }], consoleErrors[],
 *         failedRequests[{ url, status?, error? }], expectText?, text }
 */
export function checkPage(snap) {
  const out = [];
  const add = (kind, detail) => out.push({ kind, step: snap.step, url: snap.url, detail });
  const okStatus = snap.expectStatus ?? 200;
  if (snap.status && snap.status >= 400 && snap.status !== okStatus) add("page-error", `HTTP ${snap.status}`);
  for (const e of snap.consoleErrors ?? []) add("script-error", e.slice(0, 300));
  for (const r of snap.failedRequests ?? []) add("failed-request", `${r.status ? `HTTP ${r.status}` : r.error || "failed"}: ${r.url}`);
  if (!(snap.headings ?? []).length) add("no-heading", "No h1 or h2 on the page, so it does not say where you are.");
  const live = (snap.actions ?? []).filter((a) => !a.disabled);
  if (!live.length) add("dead-end", "No link or enabled button in the main content.");
  for (const a of snap.actions ?? []) {
    const name = label(a.name);
    if (!name) add("unnamed-control", `A ${a.role}${a.href ? ` to ${a.href}` : ""} has no visible text or label.`);
    else if (VAGUE_LABELS.has(name.toLowerCase().replace(/[.!…:]+$/, ""))) add("vague-label", `${a.role} "${name}"`);
  }
  if (snap.expectText) {
    const text = (snap.text || "").toLowerCase();
    const missing = [].concat(snap.expectText).filter((t) => !text.includes(t.toLowerCase()));
    if (missing.length) add("expect-missing", `After this step the page should say ${missing.map((t) => `"${t}"`).join(" and ")}, and it does not.`);
  }
  return out;
}

/** Findings for links checked after the walk. links: [{ url, status?, error?, from[] }] */
export function checkLinks(links) {
  return links
    .filter((l) => l.error || (l.status ?? 0) >= 400)
    .map((l) => ({ kind: "broken-link", step: l.from.join(", "), url: l.url, detail: `${l.url} answers ${l.error ? l.error : `HTTP ${l.status}`}.` }));
}

/** One issue to open per kind of problem, listing every page it showed on. Highest severity first. */
export function groupFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.kind}|${f.detail}`;
    const g = groups.get(key) ?? { kind: f.kind, detail: f.detail, ...KIND[f.kind], steps: [] };
    if (!g.steps.includes(f.step)) g.steps.push(f.step);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.kind.localeCompare(b.kind) || a.detail.localeCompare(b.detail));
}

/** The short markdown report: what was walked, then the issues to open. */
export function formatReport({ base, startedAt, pages, findings, signedIn }) {
  const groups = groupFindings(findings);
  const lines = [
    `# Flow check: ${base}`,
    "",
    `${startedAt}. Walked ${pages.length} steps${signedIn ? "" : " (signed out only: no sign-in link was given)"}. Found ${groups.length} issue${groups.length === 1 ? "" : "s"} to open.`,
    "",
  ];
  if (!groups.length) lines.push("Nothing to open. Every page loaded, every link answered and every step said what comes next.", "");
  else {
    lines.push("## Issues to open", "");
    for (const g of groups) lines.push(`- **[${g.severity}] ${g.title}.** ${g.detail} Seen on: ${g.steps.join("; ")}.`);
    lines.push("");
  }
  lines.push("## Steps walked", "", "| Step | Address | Status |", "| --- | --- | --- |");
  for (const p of pages) lines.push(`| ${p.step} | ${p.path} | ${p.status ?? "-"} |`);
  lines.push(
    "",
    "## For the AI read",
    "",
    "The rules above catch errors, broken links and missing words. They cannot judge whether a step is clear. `pages/` has the text and a screenshot of every step; see docs/flow-check.md for the prompt.",
    "",
  );
  return lines.join("\n");
}
