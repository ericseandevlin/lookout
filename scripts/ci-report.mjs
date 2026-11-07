// CI run summary: test coverage and a code quality report (#291). Runs in GitHub Actions after the tests:
//   node scripts/ci-report.mjs coverage/coverage-summary.json eslint-report.json >> "$GITHUB_STEP_SUMMARY"
// Reads two local JSON files and prints markdown. Nothing leaves the runner.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const [coverageFile, eslintFile] = process.argv.slice(2);
const read = (f) => (f && existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const out = [];

const coverage = read(coverageFile);
out.push("## Test coverage", "");
if (coverage) {
  out.push("| | Covered | Total | % |", "|---|---:|---:|---:|");
  for (const k of ["lines", "statements", "functions", "branches"]) {
    const t = coverage.total[k];
    out.push(`| ${k} | ${t.covered} | ${t.total} | ${t.pct}% |`);
  }
  out.push("", "Full HTML report: the `coverage` artifact on this run.");
} else {
  out.push("No coverage summary found.");
}

const eslint = read(eslintFile);
out.push("", "## Code quality (ESLint)", "");
if (eslint) {
  const byRule = new Map();
  const complex = [];
  let errors = 0;
  let warnings = 0;
  for (const file of eslint) {
    errors += file.errorCount;
    warnings += file.warningCount;
    for (const m of file.messages) {
      const rule = m.ruleId ?? "(parse)";
      byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
      if (rule === "complexity") {
        const n = Number(/complexity of (\d+)/.exec(m.message)?.[1] ?? 0);
        complex.push({ n, where: `${path.relative(process.cwd(), file.filePath)}:${m.line}` });
      }
    }
  }
  out.push(`${eslint.length} files, ${errors} errors, ${warnings} warnings.`, "");
  if (byRule.size) {
    out.push("| Rule | Count |", "|---|---:|");
    for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) out.push(`| ${rule} | ${n} |`);
  }
  if (complex.length) {
    out.push("", "Most complex functions (cyclomatic complexity over 15):", "");
    for (const c of complex.sort((a, b) => b.n - a.n).slice(0, 10)) out.push(`- ${c.n}: \`${c.where}\``);
  }
} else {
  out.push("No ESLint report found.");
}

console.log(out.join("\n"));
