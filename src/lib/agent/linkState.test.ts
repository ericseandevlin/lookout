import { describe, expect, it } from "vitest";
import { classifyPage, closedNote, ownNotes } from "./linkState";

describe("ownNotes (#792)", () => {
  it("drops Lookout's closed line and keeps what the person wrote", () => {
    const line = closedNote("page answered 404", "2026-11-01");
    expect(ownNotes(line)).toBe("");
    expect(ownNotes(`Ask Sam (recruiter) about this.\n\n${line}`)).toBe("Ask Sam (recruiter) about this.");
    expect(ownNotes(`${line}\n\nReopened, applying anyway.`)).toBe("Reopened, applying anyway.");
    expect(ownNotes("Closed: the role went to an internal hire.")).toBe("Closed: the role went to an internal hire.");
  });
});

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
  it("reads closed wording with curly apostrophes (#734)", () => {
    expect(classifyPage(200, "The position you’re looking for could not be found.").state).toBe("gone");
    expect(classifyPage(200, "Sorry, the job you’re looking for can’t be found").state).toBe("gone");
    expect(classifyPage(200, "The job you're looking for can't be found").state).toBe("gone");
  });
  it.each([
    "This job is closed",
    "Oops! The job you are looking for has been filled or removed.",
    "The position you’re trying to apply for has been closed",
    "Sorry, this position is not available anymore.",
    "This job ad has expired",
    "Job expired",
    "The page you are looking for doesn't exist.",
    "Sorry, but we can’t find that page.",
  ])("reads %s as closed (#747)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
  it.each([
    "TITLE: Product Designer\nApplications close December 1. This role is closely tied to our growth team.",
    "TITLE: Design Lead\nYou will own the closed beta and the expired-session flows.",
    "TITLE: UX Engineer\nThis position is not available to contractors.",
  ])("keeps %s open (#747)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each([
    "This job posting has closed.",
    "Applications have closed for this role.",
    "The posting has closed",
    "This vacancy has now closed",
    "Sorry, this opportunity is closed.",
    "Job Closed",
    "This requisition is no longer accepting candidates",
    "We are not accepting applications for this position at this time",
    "The job posting you're looking for might have closed or it has been removed",
  ])("reads %s as closed (#760)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
  it.each([
    "TITLE: Engineer\nThis role is closed to agencies. Apply directly.",
    "TITLE: Designer\nWe are not accepting applications from candidates who need sponsorship.",
    "TITLE: PM\nYou will lead the closed beta. Applications close Friday.",
  ])("keeps %s open (#760)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it("closed wording beats a stray maintenance mention", () => {
    expect(classifyPage(200, "We're sorry, but it looks like this job may be no longer available or does not exist. Site maintenance notice").state).toBe("gone");
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
