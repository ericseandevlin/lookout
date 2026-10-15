import { describe, expect, it } from "vitest";
import { classifyPage } from "./linkState";

describe("classifyPage", () => {
  it("treats 404 and 410 as gone", () => {
    expect(classifyPage(404, "").state).toBe("gone");
    expect(classifyPage(410, "").state).toBe("gone");
  });
  it("treats Greenhouse's ?error=true redirect as gone", () => {
    expect(classifyPage(200, "Open roles at Acme", "https://job-boards.greenhouse.io/acme?error=true").state).toBe("gone");
  });
  it("reads closed wording on a live page", () => {
    expect(classifyPage(200, "TITLE: Designer\nThis job is no longer accepting applications").state).toBe("gone");
    expect(classifyPage(200, "Sorry, the position has been filled.").state).toBe("gone");
    expect(classifyPage(200, "Job not found").state).toBe("gone");
  });
  it("never closes on maintenance, blocks or server errors", () => {
    expect(classifyPage(200, "jobs.example.com site is currently down for maintenance.").state).toBe("unknown");
    expect(classifyPage(503, "").state).toBe("unknown");
    expect(classifyPage(403, "").state).toBe("unknown");
    expect(classifyPage(200, "Please verify you are human").state).toBe("unknown");
  });
  it("keeps a normal posting open", () => {
    expect(classifyPage(200, "TITLE: Director, Product Design\nAbout the role: lead a team of 8...").state).toBe("open");
  });
});
