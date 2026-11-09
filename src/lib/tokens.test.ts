import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { color } from "./tokens";

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("color tokens", () => {
  it("text colors pass WCAG AA (4.5:1) on white and on the page background", () => {
    for (const c of [color.ink, color.t2, color.brick, color.peachInk, color.greenText]) {
      expect(contrast(c, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, color.page)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("ink text passes AA on the orange accent", () => {
    expect(contrast(color.ink, color.orange)).toBeGreaterThanOrEqual(4.5);
  });

  it("matches the CSS variables in globals.css", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const vars: Record<string, string> = { ink: "--ink", t2: "--t2", t3: "--t3", muted: "--muted", onDark: "--on-dark", brick: "--brick", orange: "--orange", peachInk: "--peach-ink", green: "--green", greenText: "--green-text", page: "--page", border: "--border", surface: "--surface" };
    for (const [k, v] of Object.entries(vars)) {
      const m = css.match(new RegExp(`${v}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m?.[1].toUpperCase(), k).toBe(color[k as keyof typeof color]);
    }
  });
});
