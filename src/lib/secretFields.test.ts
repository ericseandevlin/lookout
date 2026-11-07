import { describe, expect, it } from "vitest";
import { nextSecret, openSecretFields } from "./secretFields";

const dec = (b: string) => {
  if (!b.startsWith("ok:")) throw new Error("bad tag");
  return b.slice(3);
};

describe("openSecretFields (#274)", () => {
  it("decrypts readable fields and leaves others alone", () => {
    expect(openSecretFields({ apiKey: "ok:sk-1", model: "m" }, ["apiKey"], dec)).toEqual({ saved: { apiKey: "sk-1", model: "m" }, unreadable: [] });
  });
  it("blanks and reports a field it can't read, so the env key doesn't sneak back", () => {
    const r = openSecretFields({ apiKey: "garbled" }, ["apiKey"], dec);
    expect(r.saved.apiKey).toBe("");
    expect("apiKey" in r.saved).toBe(true);
    expect(r.unreadable).toEqual(["apiKey"]);
  });
  it("skips empty or missing fields", () => {
    expect(openSecretFields({ apiKey: "" }, ["apiKey", "braveKey"], dec).unreadable).toEqual([]);
  });
});

describe("nextSecret", () => {
  const enc = (p: string) => `ok:${p}`;
  it("encrypts a newly typed key", () => expect(nextSecret("sk-2", "garbled", enc)).toBe("ok:sk-2"));
  it("keeps the stored blob when nothing is typed, even one it can't read", () => {
    expect(nextSecret("", "garbled", enc)).toBe("garbled");
    expect(nextSecret("", undefined, enc)).toBe("");
  });
});
