import { describe, expect, it } from "vitest";
import { compLabel } from "./digestComp";

describe("compLabel (#492)", () => {
  it("shows whichever ends are posted", () => {
    expect(compLabel(150000, 200000)).toBe("$150,000 – $200,000");
    expect(compLabel(150000, null)).toBe("$150,000+");
    expect(compLabel(null, 200000)).toBe("Up to $200,000");
    expect(compLabel(180000, 180000)).toBe("$180,000");
    expect(compLabel(null, null)).toBeNull();
    expect(compLabel(0, 0)).toBeNull();
  });
  it("writes the currency code instead of $ when it isn't USD", () => {
    expect(compLabel(60000, 80000, "GBP")).toBe("60,000 – 80,000 GBP");
    expect(compLabel(90000, null, "EUR")).toBe("90,000+ EUR");
    expect(compLabel(100000, 120000, "")).toBe("$100,000 – $120,000");
  });
});
