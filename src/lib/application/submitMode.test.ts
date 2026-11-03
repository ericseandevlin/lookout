import { describe, expect, it } from "vitest";
import { routeFor, type Ats } from "./scan";
import { AUTO_ATS, submitMode } from "./submitMode";

describe("submitMode", () => {
  it("sends on its own only on Greenhouse, Lever and Ashby, with the switch on", () => {
    for (const ats of AUTO_ATS) expect(submitMode({ ats, autoSubmit: true }).mode).toBe("auto");
    for (const ats of ["workday", "smartrecruiters", "other"]) expect(submitMode({ ats, autoSubmit: true }).mode).toBe("press");
  });

  it("is press Submit everywhere while the switch is off", () => {
    const m = submitMode({ ats: "greenhouse", autoSubmit: false });
    expect(m.mode).toBe("press");
    expect(m.why).toMatch(/turned off/);
  });

  it("guesses from the posting URL before the form is read", () => {
    expect(submitMode({ url: "https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-000000000000", autoSubmit: true }).mode).toBe("auto");
    expect(submitMode({ url: "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/123", autoSubmit: true }).why).toMatch(/Workday/);
    expect(submitMode({ url: "https://example.com/careers/1", autoSubmit: true }).mode).toBe("press");
    expect(submitMode({ url: null, autoSubmit: true }).mode).toBe("press");
  });

  it("the read form wins over the URL guess", () => {
    expect(submitMode({ ats: "greenhouse", url: "https://example.com/careers/1", autoSubmit: true }).mode).toBe("auto");
  });

  it("a CAPTCHA turns it into press Submit and says why", () => {
    const m = submitMode({ ats: "ashby", autoSubmit: true, captcha: true });
    expect(m.mode).toBe("press");
    expect(m.why).toMatch(/CAPTCHA/);
  });

  it("matches the sites the browser worker will open", () => {
    for (const ats of AUTO_ATS) expect(routeFor(ats)).toBe("browser");
    for (const ats of ["workday", "smartrecruiters", "other"] as Ats[]) expect(routeFor(ats)).toBe("manual");
  });
});
