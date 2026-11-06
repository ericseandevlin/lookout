import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { decrypt, encrypt, isSealedFile, openFile, sealFile } = await import("./secrets");

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
