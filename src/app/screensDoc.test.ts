import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/screens.md is the owner's list of every page (#1336). Every page.tsx needs a row there,
// and every row must still point at a page, so the list can't drift from the app.
const appDir = path.resolve(__dirname);
const doc = readFileSync(path.resolve(__dirname, "../../docs/screens.md"), "utf8");

function pageFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "api" ? [] : pageFiles(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

/** src/app/(app)/apply/[id]/page.tsx -> /apply/[id]. Route groups like (app) are not part of the URL. */
function routeOf(file: string): string {
  const parts = path.relative(appDir, path.dirname(file)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + parts.join("/");
}

/** The URL in the first cell of each table row, e.g. "| `/finds` | ...". */
function documentedRoutes(md: string): string[] {
  return [...md.matchAll(/^\| `(\/[^`]*)` \|/gm)].map((m) => m[1]);
}

describe("docs/screens.md", () => {
  const routes = pageFiles(appDir).map(routeOf).sort();
  const rows = documentedRoutes(doc);

  it("maps page files to URLs", () => {
    expect(routeOf(path.join(appDir, "page.tsx"))).toBe("/");
    expect(routeOf(path.join(appDir, "(app)", "apply", "[id]", "page.tsx"))).toBe("/apply/[id]");
    expect(routes).toContain("/finds");
  });

  it("has a row for every page", () => {
    const missing = routes.filter((r) => !rows.includes(r));
    expect(missing, `Add these pages to docs/screens.md: ${missing.join(", ")}`).toEqual([]);
  });

  it("has no row for a page that no longer exists", () => {
    const stale = rows.filter((r) => !routes.includes(r));
    expect(stale, `Remove these rows from docs/screens.md: ${stale.join(", ")}`).toEqual([]);
  });

  it("lists each page once", () => {
    expect(rows.length).toBe(new Set(rows).size);
  });
});
