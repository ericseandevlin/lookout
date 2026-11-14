import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONFIRMATION } from "@/lib/application/fillPlan";

/**
 * The thank-you pattern is copied into both extension scripts, which can't import from src (#1134). Each copy must be
 * the worker's CONFIRMATION, or the extension and the worker disagree on whether an application went through.
 */
const FILES = ["fill.js", "background.js"];

function thanksIn(file: string): RegExp {
  const src = readFileSync(path.resolve(__dirname, "../../../extension/firefox", file), "utf8");
  const literal = src.match(/const THANKS = (\/.+\/[a-z]*);\n/)?.[1];
  if (!literal) throw new Error(`no THANKS in ${file}`);
  return new Function(`return ${literal};`)() as RegExp;
}

describe("extension THANKS matches the worker's CONFIRMATION (#1134)", () => {
  it.each(FILES)("%s has the same pattern and flags", (file) => {
    const re = thanksIn(file);
    expect(re.source).toBe(CONFIRMATION.source);
    expect(re.flags).toBe(CONFIRMATION.flags);
  });

  it.each(FILES)("%s reads the same pages as sent", (file) => {
    const re = thanksIn(file);
    for (const [t, sent] of [
      ["Thank you for applying!", true],
      ["Your application has been received", true],
      ["Don't close this page yet. You have successfully applied.", true],
      ["Thank you for your interest in joining our team. Please complete the form below.", false],
      ["Once your application has been received, we will review it.", false],
      ["Your application has not been successfully submitted.", false],
    ] as const)
      expect(re.test(t), `${file}: ${t}`).toBe(sent);
  });
});
