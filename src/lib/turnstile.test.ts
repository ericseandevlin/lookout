import { afterEach, describe, expect, it, vi } from "vitest";
import { turnstileSiteKey, verifyTurnstile } from "./turnstile";

const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

afterEach(() => vi.unstubAllEnvs());

describe("turnstileSiteKey (#13)", () => {
  it("is off unless both keys are set", () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    expect(turnstileSiteKey()).toBe("");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    expect(turnstileSiteKey()).toBe("site");
  });
});

describe("verifyTurnstile (#13)", () => {
  it("posts the secret, token and IP and trusts only success: true", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const f = reply({ success: true });
    expect(await verifyTurnstile("tok", "203.0.113.5", f)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const sent = init.body as URLSearchParams;
    expect([sent.get("secret"), sent.get("response"), sent.get("remoteip")]).toEqual(["secret", "tok", "203.0.113.5"]);
    expect(await verifyTurnstile("tok", "1.2.3.4", reply({ success: false, "error-codes": ["invalid-input-response"] }))).toBe(false);
    expect(await verifyTurnstile("tok", "1.2.3.4", reply({}))).toBe(false);
  });

  it("fails closed with no token, an error status or no answer", async () => {
    const f = reply({ success: true });
    expect(await verifyTurnstile(undefined, "1.2.3.4", f)).toBe(false);
    expect(await verifyTurnstile("", "1.2.3.4", f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(await verifyTurnstile("tok", "1.2.3.4", reply({ success: true }, false))).toBe(false);
    expect(await verifyTurnstile("tok", "1.2.3.4", vi.fn(async () => Promise.reject(new Error("down"))))).toBe(false);
  });

  it("leaves out an unknown IP", async () => {
    const f = reply({ success: true });
    await verifyTurnstile("tok", "unknown", f);
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams).has("remoteip")).toBe(false);
  });
});
