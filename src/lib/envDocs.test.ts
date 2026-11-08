import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Every env var the server reads must have a row in the README Configuration table,
// so a self-hoster can find it (#390). Node and Next set these themselves.
const BUILT_IN = new Set(["NODE_ENV", "NEXT_RUNTIME"]);

const root = path.resolve(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function namesRead(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) found.push(m[1]);
  for (const m of code.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g)) found.push(m[1]);
  for (const m of code.matchAll(/\b(?:envNumber|required)\(["']([A-Z][A-Z0-9_]*)["']/g)) found.push(m[1]);
  for (const m of code.matchAll(/\bfeatureOn\(["']([A-Z][A-Z0-9_]*)["']\)/g)) found.push(`FEATURE_${m[1]}`);
  return found;
}

function documented(readme: string): Set<string> {
  const rows = readme.split("\n").filter((l) => l.startsWith("| `"));
  return new Set(rows.flatMap((l) => [...l.split("|")[1].matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1])));
}

describe("README Configuration table", () => {
  it("lists every env var read under src", () => {
    const read = new Set(sources(path.join(root, "src")).flatMap((f) => namesRead(readFileSync(f, "utf8"))));
    const docs = documented(readFileSync(path.join(root, "README.md"), "utf8"));
    const missing = [...read].filter((n) => !BUILT_IN.has(n) && !docs.has(n)).sort();
    expect(missing).toEqual([]);
  });

  it("finds the names it should", () => {
    expect(namesRead('process.env.APP_URL; process.env["FEATURE_X"]; envNumber("SEARCH_PRICE", 1); featureOn("EVENTS")')).toEqual([
      "APP_URL",
      "FEATURE_X",
      "SEARCH_PRICE",
      "FEATURE_EVENTS",
    ]);
  });
});
