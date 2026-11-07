import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { decrypt, encrypt, isSealedFile, mask, openFile, sealFile } = await import("./secrets");

const A = "a".repeat(32);
const B = "b".repeat(32);

describe("secrets", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips with the current secret", () => {
    vi.stubEnv("APP_SECRET", A);
    expect(decrypt(encrypt("sk-test"))).toBe("sk-test");
  });

  it("reads values sealed with the previous secret during a rotation (#244)", () => {
    vi.stubEnv("APP_SECRET", A);
    const old = encrypt("sk-test");
    vi.stubEnv("APP_SECRET", B);
    expect(() => decrypt(old)).toThrow();
    vi.stubEnv("APP_SECRET_PREVIOUS", A);
    expect(decrypt(old)).toBe("sk-test");
    expect(decrypt(encrypt("new")).length).toBe(3);
  });

  it("ignores a previous secret that is too short", () => {
    vi.stubEnv("APP_SECRET", A);
    const old = encrypt("x");
    vi.stubEnv("APP_SECRET", B);
    vi.stubEnv("APP_SECRET_PREVIOUS", "short");
    expect(() => decrypt(old)).toThrow();
  });

  it("uses a fresh IV for every value", () => {
    vi.stubEnv("APP_SECRET", A);
    expect(encrypt("sk-test")).not.toBe(encrypt("sk-test"));
  });

  it("refuses an unknown format and a truncated tag", () => {
    vi.stubEnv("APP_SECRET", A);
    expect(() => decrypt("v2:a:b:c")).toThrow("Unknown secret format");
    expect(() => decrypt("plain text")).toThrow("Unknown secret format");
    const [v, iv, tag, data] = encrypt("sk-test").split(":");
    const short = Buffer.from(tag, "base64").subarray(0, 8).toString("base64");
    expect(() => decrypt([v, iv, short, data].join(":"))).toThrow("Bad secret tag");
  });

  it("needs an APP_SECRET of 32+ characters", () => {
    vi.stubEnv("APP_SECRET", "");
    expect(() => encrypt("x")).toThrow("APP_SECRET");
    vi.stubEnv("APP_SECRET", "short");
    expect(() => encrypt("x")).toThrow("APP_SECRET");
  });

  it("masks all but the first and last four characters", () => {
    expect(mask("sk-abcdefghijkl")).toBe("sk-a…ijkl");
    expect(mask("")).toBe("");
  });
});

describe("files at rest (#16)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const pdf = Buffer.from("%PDF-1.7 resume body");

  it("seals so the bytes on disk aren't the file, and opens back to it", () => {
    vi.stubEnv("APP_SECRET", A);
    const sealed = sealFile(pdf);
    expect(isSealedFile(sealed)).toBe(true);
    expect(sealed.includes(Buffer.from("resume body"))).toBe(false);
    expect(openFile(sealed).equals(pdf)).toBe(true);
  });

  it("passes plain files saved before encryption through unchanged", () => {
    vi.stubEnv("APP_SECRET", A);
    expect(openFile(pdf).equals(pdf)).toBe(true);
  });

  it("opens with the previous secret during a rotation, refuses a tampered file", () => {
    vi.stubEnv("APP_SECRET", A);
    const sealed = sealFile(pdf);
    vi.stubEnv("APP_SECRET", B);
    expect(() => openFile(sealed)).toThrow();
    vi.stubEnv("APP_SECRET_PREVIOUS", A);
    expect(openFile(sealed).equals(pdf)).toBe(true);
    const bad = Buffer.from(sealed);
    bad[bad.length - 1] ^= 1;
    expect(() => openFile(bad)).toThrow();
  });
});
