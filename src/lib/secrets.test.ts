import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { decrypt, encrypt } = await import("./secrets");

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
