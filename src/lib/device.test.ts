import { describe, expect, it } from "vitest";
import { deviceName } from "./device";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)";

describe("deviceName", () => {
  it("names iOS browsers by their own token, not Safari", () => {
    expect(deviceName(`${iphone} CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1`)).toBe("Chrome on iPhone");
    expect(deviceName(`${iphone} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`)).toBe("Firefox on iPhone");
    expect(deviceName(`${iphone} EdgiOS/126.2592.56 Version/17.0 Mobile/15E148 Safari/604.1`)).toBe("Edge on iPhone");
    expect(deviceName(`${iphone} Version/17.5 Mobile/15E148 Safari/604.1`)).toBe("Safari on iPhone");
  });

  it("names Opera as Opera, not Chrome", () => {
    expect(deviceName(`${windows} Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0`)).toBe("Opera on Windows");
  });

  it("names desktop browsers", () => {
    expect(deviceName(`${mac} Chrome/126.0.0.0 Safari/537.36`)).toBe("Chrome on Mac");
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe("Safari on Mac");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0")).toBe("Firefox on Windows");
    expect(deviceName(`${windows} Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0`)).toBe("Edge on Windows");
  });

  it("handles a missing user agent", () => {
    expect(deviceName(null)).toBe("Unknown device");
  });
});
