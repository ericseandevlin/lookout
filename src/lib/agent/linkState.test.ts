import { describe, expect, it } from "vitest";
import { classifyPage, closedNote, ownNotes, repostedNote } from "./linkState";

describe("ownNotes (#792)", () => {
  it("drops Lookout's closed line and keeps what the person wrote", () => {
    const line = closedNote("page answered 404", "2026-11-01");
    expect(ownNotes(line)).toBe("");
    expect(ownNotes(`Ask Sam (recruiter) about this.\n\n${line}`)).toBe("Ask Sam (recruiter) about this.");
    expect(ownNotes(`${line}\n\nReopened, applying anyway.`)).toBe("Reopened, applying anyway.");
    expect(ownNotes("Closed: the role went to an internal hire.")).toBe("Closed: the role went to an internal hire.");
  });

  it("drops Lookout's reposted line too (#1362)", () => {
    const closed = closedNote("page answered 404", "2026-11-01");
    const reposted = repostedNote("2026-11-19", "https://jobs.example.com/acme/456");
    expect(ownNotes(`${closed}\n\n${reposted}`)).toBe("");
    expect(ownNotes(`Ask Sam about this.\n\n${closed}\n\n${reposted}`)).toBe("Ask Sam about this.");
    expect(ownNotes("Reposted on LinkedIn, maybe apply there.")).toBe("Reposted on LinkedIn, maybe apply there.");
  });
});

describe("classifyPage", () => {
  it("treats 404 and 410 as gone", () => {
    expect(classifyPage(404, "").state).toBe("gone");
    expect(classifyPage(410, "").state).toBe("gone");
  });
  it("treats Workable's ?not_found=true redirect as gone (#1099)", () => {
    expect(classifyPage(200, "Workable", "https://apply.workable.com/acme/?not_found=true")).toEqual({ state: "gone", reason: "the job board says it's closed" });
    expect(classifyPage(200, "Workable", "https://apply.workable.com/acme/j/ABC123/").state).toBe("open");
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
  it.each(["This job opening is closed.", "This job opening has closed.", "This requisition is closed.", "This job posting is expired.", "This job opening has expired."])(
    "reads %s as closed (#1361)",
    (text) => {
      expect(classifyPage(200, text).state).toBe("gone");
    },
  );
  it.each([
    "TITLE: Designer\nThis job opening is closed to agencies. Apply directly.",
    "TITLE: Designer\nRequisition closed date: 12/31. Apply now.",
    "TITLE: Designer\nJob opening expired-date: 2026-12-31",
  ])("keeps %s open (#1361)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each([
    "TITLE: Engineer\nThis role is closed to agencies. Apply directly.",
    "TITLE: Designer\nWe are not accepting applications from candidates who need sponsorship.",
    "TITLE: PM\nYou will lead the closed beta. Applications close Friday.",
  ])("keeps %s open (#760)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each(["Applications for this role are closed to agencies. Apply now.", "Applications are closed to third-party recruiters."])("keeps %s open (#1103)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each(["Applications are closed.", "Applications for this position have now closed. Thank you."])("still reads %s as closed (#1103)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
  it.each([
    "Applications for this vacancy are now closed.",
    "Applications for this posting have closed.",
    "Applications for this opportunity are closed.",
    "Applications are no longer being accepted for this position.",
    "Applications are no longer being considered.",
  ])("reads %s as closed (#1158)", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("gone");
  });
  it.each([
    "Applications for this vacancy are closed to agencies. Apply now.",
    "Applications are no longer being accepted from third-party agencies. Apply now.",
    "Applications are no longer being accepted via email. Please apply through this page.",
    "Applications are no longer being accepted by email; use the form below.",
  ])("keeps %s open (#1158)", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
  it.each(["Applications for this position are no longer being accepted.", "Applications for this role are no longer being considered."])(
    "reads %s as closed (#1732)",
    (text) => {
      expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("gone");
    },
  );
  it("keeps 'Applications for this position are no longer being accepted from agencies' open (#1732)", () => {
    expect(classifyPage(200, "TITLE: Product Designer\nTEXT: Applications for this position are no longer being accepted from agencies. Apply now.").state).toBe("open");
  });
  it.each([
    "TITLE: Senior Designer\nPosition Closed Date 11/30/2026. Apply now.",
    "TITLE: Director of UX\nOpportunity Closed Date: 12/31/2026",
    "TITLE: Design Lead\nJob Posting Closed-Date: December 15, 2026",
    "TITLE: Product Designer\nThis role is closed-loop: you own research through launch.",
  ])("keeps %s open (#832)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each([
    "TITLE: Designer\nWe are not accepting applications at this time from third-party recruiters.",
    "TITLE: Designer\nWe are not accepting applications for this role from candidates who require sponsorship.",
    "TITLE: Senior Designer\nJob Posting Expired Date: 12/31/2026\nApply now",
    "TITLE: Design Lead\nPosting Expired-Date: December 15, 2026",
  ])("keeps %s open (#1083)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each(["We are not accepting applications at this time.", "This job has expired.", "Job posting expired"])("still reads %s as closed (#1083)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
  it.each(["This job has closed. Closed date: 2026-11-01", "Job Closed - see our other openings", "This position is closed."])("still reads %s as closed (#832)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
  it.each([
    "Review of applications begins November 1 and continues until the position has been filled.",
    "This posting will remain open until the position has been filled.",
    "Once the position has been filled, this posting will be removed.",
    "Applications are accepted until this position has been filled.",
    "This role is no longer open to candidates requiring sponsorship.",
  ])("keeps %s open (#903)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each([
    "Applications will be accepted till the position has been filled.",
    "This posting stays open 'til the role has been filled.",
    "We review applications on a rolling basis til this position is filled.",
    "Open ’til this job has been filled.",
  ])("keeps %s open: till and 'til read like until (#1101)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each([
    "Our San Francisco office is no longer open; this role is fully remote.",
    "The Austin store is no longer open, so this team works from Dallas.",
  ])("keeps %s open: something else is no longer open, not the job (#1298)", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });
  it.each(["The job you are looking for is no longer open.", "No longer open", "Sorry, this posting is no longer open. See other roles."])("still reads %s as closed (#1298)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
  it.each(["Sorry, the position has been filled.", "This position has been filled. Thank you for your interest.", "This job is no longer open."])("still reads %s as closed (#903)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
  it.each([
    "TITLE: Senior Product Designer, Design Systems\nTEXT: You will own the creation and maintenance of our design system. Apply now.",
    "TITLE: Facilities Maintenance Manager\nTEXT: Keep our offices running. Apply now.",
  ])("reads a live posting that mentions maintenance as open (#933): %s", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });

  it.each([
    "TITLE: Designer\nTEXT: Visa sponsorship is no longer available for this role. Apply now",
    "TITLE: Designer\nTEXT: We are no longer accepting candidates from third-party agencies. Apply now",
    "TITLE: Designer\nTEXT: Our old office is no longer active; we are fully remote. Apply now",
    // #1027: the channel changed, not the job.
    "TITLE: Designer\nTEXT: We are no longer accepting applications via email. Please apply through this page.",
    "TITLE: Designer\nTEXT: We are no longer accepting applications by email; use the form below.",
    "TITLE: Designer\nTEXT: We are no longer accepting applications through LinkedIn. Apply here instead.",
  ])("keeps a live posting whose side note says no longer (#933): %s", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });

  it.each([
    "This listing is no longer available.",
    "Sorry, this job may be no longer available.",
    "TITLE: Designer\nNo longer available",
    "Oops! No longer posted.",
    "We are no longer accepting candidates for this role.",
    "We are no longer accepting applications.",
    "This role is no longer accepting applications through this portal.",
  ])("still reads %s as closed (#933)", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });

  it.each(["Scheduled maintenance in progress. Back soon.", "This site is under maintenance.", "Careers is offline due to planned maintenance."])(
    "still reads a maintenance page as unknown (#933): %s",
    (text) => {
      expect(classifyPage(200, text).state).toBe("unknown");
    },
  );

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

describe("\"filled\" wording (#957)", () => {
  it.each([
    "Applications will be accepted until such time as the position has been filled.",
    "This posting will remain open until such time as the role has been filled.",
  ])("keeps a live posting open: %s", (text) => {
    expect(classifyPage(200, `TITLE: Program Manager\nTEXT:\n${text}`).state).toBe("open");
  });
  it.each(["Sorry, this position has already been filled.", "This role has already been filled.", "Unfortunately, the position has now been filled."])(
    "reads a filled posting as gone: %s",
    (text) => {
      expect(classifyPage(200, `TITLE: Program Manager\nTEXT:\n${text}`).state).toBe("gone");
    },
  );
});


describe("live wording that reads like closed, and closed wording that was missed (#980)", () => {
  it.each([
    "Applications will be accepted until such time as this position has been filled.",
    "This posting will be taken down as soon as the position has been filled.",
    "Applications are reviewed on a rolling basis until the job opening has been filled.",
    "We will accept applications until this role has been filled.",
    "Visa sponsorship for this position is no longer available.",
    "Relocation support for this role is no longer available.",
  ])("keeps a live posting open: %s", (text) => {
    expect(classifyPage(200, `TITLE: Senior Product Designer\nTEXT:\n${text}`).state).toBe("open");
  });
  it.each([
    "This position is no longer accepting applicants.",
    "This vacancy has expired.",
    "This opportunity has expired.",
    "Sorry, this job is no longer available.",
    "Thanks for applying! Once again, this position has been filled.",
  ])("reads a closed posting as gone: %s", (text) => {
    expect(classifyPage(200, `TITLE: Senior Product Designer\nTEXT:\n${text}`).state).toBe("gone");
  });
});

describe("a condition word only counts when it leads into the closed phrase (#1006)", () => {
  it.each([
    "Thank you for your interest. After careful consideration, this position has been filled.",
    "Unfortunately, after a great response, this job is no longer available.",
    "Due to a high volume of applications received before the deadline, applications are now closed.",
    "When we posted this role we got a big response; this posting has expired.",
  ])("reads a closed posting as gone: %s", (text) => {
    expect(classifyPage(200, `TITLE: Senior Product Designer\nTEXT:\n${text}`).state).toBe("gone");
  });

  it("reads the line before \"No longer available\" as its own line", () => {
    expect(classifyPage(200, "TITLE: After School Program Coordinator\nTEXT:\nAfter School Program Coordinator\nNo longer available").state).toBe("gone");
  });

  it.each([
    "Once the role is filled, the posting is closed.",
    "If the position has been filled, this page will say so.",
    "Applications are reviewed after the deadline until the position has been filled.",
    "We review applications weekly; after the role has been filled the posting is removed.",
  ])("keeps a live posting open: %s", (text) => {
    expect(classifyPage(200, `TITLE: Senior Product Designer\nTEXT:\n${text}`).state).toBe("open");
  });
});

describe("a perk that is no longer available is not the job (#1007)", () => {
  const live = (line: string) => `TITLE: Senior Product Designer\nTEXT:\nSenior Product Designer\nNew York, NY (Hybrid)\nAbout the role: lead design for our payments app.\n${line}\nResponsibilities: ship work. Apply now.`;
  it.each([
    "Visa sponsorship: No longer available for this role.",
    "Relocation assistance: no longer available.",
    "Please note: the opportunity to work fully remote is no longer available; this role is hybrid.",
  ])("keeps a live posting open: %s", (line) => {
    expect(classifyPage(200, live(line)).state).toBe("open");
  });
  it.each(["TITLE: Designer\nTEXT: No longer available", "Status: No longer available", "Job: no longer posted", "This opportunity is no longer available."])(
    "still reads a closed page as gone: %s",
    (text) => {
      expect(classifyPage(200, text).state).toBe("gone");
    },
  );
});

describe("more closed wordings (#1251)", () => {
  it.each([
    "This vacancy has been filled.",
    "This opportunity has been filled.",
    "This listing has been removed.",
    "This listing has been filled.",
    "This job ad has been removed.",
    "The job you are trying to apply for is no longer available.",
    "The position you are attempting to view is no longer available.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("gone");
  });
  it.each([
    "We will accept applications until the vacancy has been filled. Apply now.",
    "Once this opportunity has been filled, the listing will come down. Apply now.",
    "The opportunity to work from anywhere is no longer available. Apply now.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("a job that was removed (#1271)", () => {
  it.each([
    "Sorry, this job was removed at 3:14 a.m. (CST) on Friday, November 7, 2026.",
    "This position was filled.",
    "This posting was closed by the employer.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("gone");
  });
  it.each([
    "This role was created to lead our design system. Apply now.",
    "This position was available to remote candidates last year; it is now hybrid. Apply now.",
    "The person in this role was filled in on our roadmap. Apply now.",
    "We will review applications until the position was filled. Apply now.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("a job post or advert that expired, closed or was archived (#1279)", () => {
  it.each([
    "This job post has expired.",
    "This job post is closed.",
    "This advert has expired.",
    "This job advert has now closed.",
    "This job has been archived.",
    "Sorry, this posting was archived by the employer.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("gone");
  });
  it.each([
    "Job Post Expired Date: 12/31/2026. Apply now.",
    "This job post is closed to agencies. Apply now.",
    "We archived our old design system and this role will build the new one. Apply now.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("stock closed-job pages (#1427)", () => {
  it.each([
    "This job no longer exists.",
    "Sorry, the job listing you are looking for no longer exists.",
    "The job you are looking for does not exist.",
    "This job does not exist anymore.",
    "Sorry, this job is not available.",
    "The job you are looking for is not available.",
    "This position is not currently accepting applications",
    "Applications closed",
    "The application deadline has passed.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `Careers\n${text}`).state).toBe("gone");
  });
  it.each([
    "This is a role that doesn't exist yet: you will define it.",
    "This position does not exist at most companies. Apply now.",
    "This role is not available for visa sponsorship. Apply now.",
    "We are not currently accepting applications from agencies. Apply now.",
    "Applications closed on a rolling basis are reviewed weekly. Apply now.",
    "Apply before the deadline. Once the application deadline has passed, we review every submission.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("a deadline that has passed (#1714)", () => {
  it.each([
    "The deadline to apply for this job has passed.",
    "The deadline for this position has passed.",
    "The application deadline for this role has now passed.",
    "Sorry, the deadline for applications has already passed.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `Careers\n${text}`).state).toBe("gone");
  });
  it.each([
    "The deadline to apply for this job is December 15. Apply now.",
    "If the deadline for this position has passed, we will still review your application.",
    "Make sure you apply before the deadline for this role. Once the deadline to apply has passed, we review every submission.",
    "You will manage projects and track when the deadline for each deliverable has passed.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("apply-to and soft 404 wordings (#1441)", () => {
  it.each([
    "The job you're trying to apply to has been closed.",
    "The position you are attempting to apply to is no longer available.",
    "The page you requested could not be found.",
    "Sorry, the page you have requested cannot be found on our server.",
    "This page can't be found.",
    "The job could not be found.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `Careers\n${text}`).state).toBe("gone");
  });
  it.each([
    "Apply soon. Until the job you're trying to apply to has been filled, we review every week.",
    "The right person for this job cannot be found on other boards, so we post here. Apply now.",
    "We built a page that cannot be found anywhere else: our design system docs. Apply now.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("no longer live, deleted, withdrawn and cancelled (#1451)", () => {
  it.each([
    "This job is no longer live.",
    "Sorry, this job is no longer live",
    "This job has been deleted.",
    "This job listing has been deleted",
    "This job has been taken down",
    "The job ad has been withdrawn",
    "This job has been unpublished",
    "This position has been cancelled.",
    "This requisition was canceled.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `Careers\n${text}`).state).toBe("gone");
  });
  it.each([
    "Apply now. Once this position has been cancelled or filled, we take the posting down.",
    "The visa requirement for this role has been withdrawn. Apply now.",
    "The travel for this role has been taken down to two days a month. Apply now.",
    "Our old app is no longer live; you will build its replacement. Apply now.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("no longer hiring and stopped accepting applications (#1458)", () => {
  it.each([
    "We're no longer hiring for this role.",
    "We’re no longer hiring for this position",
    "We are no longer recruiting for this position.",
    "We have stopped accepting applications for this job.",
    "The company has stopped accepting applications.",
    "We've stopped accepting candidates for this opening.",
  ])("reads %s as closed", (text) => {
    expect(classifyPage(200, `Careers\n${text}`).state).toBe("gone");
  });
  it.each([
    "We are no longer recruiting through agencies. Apply now.",
    "We have stopped accepting applications from third-party recruiters. Apply below.",
    "We have stopped accepting applications by email; apply on this page.",
    "Once we have stopped accepting applications for this role, we take the posting down. Apply now.",
    "You will lead hiring for this role's team as it grows. Apply now.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, `TITLE: Product Designer\nTEXT: ${text}`).state).toBe("open");
  });
});

describe("classifyPage: duties about other jobs closing are not the posting closing (#1493)", () => {
  const page = (duty: string) => `TITLE: Recruiting Coordinator - Acme\n\nTEXT:\nAcme builds tools for teams.\nWhat you'll do\n${duty}`;
  it.each([
    "Confirm every requisition is closed out in Workday at offer acceptance.",
    "Make sure each requisition is closed in Greenhouse and the hiring team is told.",
    "Keep Salesforce clean: every opportunity is closed won or closed lost within 90 days.",
    "Report monthly on how quickly each role is closed.",
    "Make sure every role has been filled before the quarter ends.",
  ])("keeps %j open", (duty) => {
    expect(classifyPage(200, page(duty)).state).toBe("open");
  });

  it("still reads the posting's own closed line as gone", () => {
    expect(classifyPage(200, "TITLE: Acme\n\nTEXT:\nThis requisition is closed.").state).toBe("gone");
    expect(classifyPage(200, "TITLE: Acme\n\nTEXT:\nThis job is closed in all locations.").state).toBe("gone");
    expect(classifyPage(200, "TITLE: Acme\n\nTEXT:\nJob Closed").state).toBe("gone");
    expect(classifyPage(200, "TITLE: Acme\n\nTEXT:\nThis position has been filled.").state).toBe("gone");
  });
});

describe("classifyPage: a job that changed work mode or city is still open (#1494)", () => {
  it.each([
    "Update (Nov 3): This role is no longer available as fully remote. It is now hybrid, three days a week in our New York office.",
    "Note: this position is no longer open as a remote role; candidates must be within commuting distance of Austin.",
    "This position is no longer available in Austin and is now based in Denver.",
    "This role is no longer available for remote candidates.",
  ])("keeps %j open", (line) => {
    expect(classifyPage(200, `TITLE: Designer - Acme\n\nTEXT:\n${line}\nWhat you'll do\nDesign things.`).state).toBe("open");
  });

  it("still reads a plain no longer available as gone", () => {
    expect(classifyPage(200, "TITLE: Acme\n\nTEXT:\nThis role is no longer available.").state).toBe("gone");
    expect(classifyPage(200, "TITLE: Acme\n\nTEXT:\nThis position is no longer available for applications.").state).toBe("gone");
  });
});

describe("duties about a page people can't find (#1553)", () => {
  const posting = (duty: string) =>
    `TITLE: Senior Content Designer at Acme\n\nTEXT:\nAcme is hiring a Senior Content Designer.\nWhat you'll do\n${duty}\nPartner with research and engineering.\nRequirements\n5+ years of content design.`;
  it.each([
    "Rework site navigation so customers who can't find the page they need get there in one click.",
    "Write error-state copy, like the message shown to users who couldn't find the page, across web and app.",
    "Write microcopy for empty states and the screen that says the page you're looking for doesn't exist.",
    "Help visitors who could not find the page.",
  ])("keeps %s open", (duty) => {
    expect(classifyPage(200, posting(duty)).state).toBe("open");
  });

  it.each([
    "Sorry, we couldn't find that page.",
    "We can't find the page you're looking for.",
    "We couldn’t find the page you were looking for. Go back to all jobs",
    "Oops! The page you're looking for doesn't exist.",
    "Sorry, the page you are looking for does not exist",
    "Hmm, we can't find this page",
  ])("still reads %s as closed", (text) => {
    expect(classifyPage(200, `TITLE: Acme Careers\n\nTEXT:\n${text}`).state).toBe("gone");
  });
});

describe("duties about a 404 screen or an expired posting (#1516)", () => {
  it.each([
    "Product Designer. Own our 404 page not found experience and empty states.",
    "Software Engineer\nPage not found errors are something you'll debug daily.",
    "Senior Designer. You will help fix 404 errors that are not found by crawlers.",
    "Customer Success. Help customers whose job posting expired renew it.",
    "Ops Manager. Make sure the listing has expired items cleaned up.",
  ])("keeps %s open", (text) => {
    expect(classifyPage(200, text).state).toBe("open");
  });

  it.each([
    "Page not found",
    "Page Not Found | Acme Careers",
    "404 - Page not found",
    "Oops! Page not found.\nGo back to all jobs",
    "Error 404: the page you requested doesn't exist.",
    "This job posting expired on 10/12/2026.",
    "This job has expired and is no longer accepting applications.",
    "Job posting expired",
  ])("still reads %s as closed", (text) => {
    expect(classifyPage(200, text).state).toBe("gone");
  });
});

describe("classifyPage: 'for this job posting' and 'every job posting' are not the posting closing (#1569)", () => {
  const page = (line: string) => `TITLE: Designer - Acme\n\nTEXT:\nAcme builds tools for teams.\n${line}\nWhat you'll do\nDesign things.`;
  it.each([
    "Visa sponsorship for this job posting is no longer available.",
    "Relocation support for this job opening is no longer available.",
    "Visa sponsorship for the role posting is no longer available.",
    "Make sure every job posting is closed in Greenhouse and the hiring team is told.",
    "Confirm each job opening has been filled before the quarter ends.",
  ])("keeps %j open", (line) => {
    expect(classifyPage(200, page(line)).state).toBe("open");
  });

  it("still reads the posting's own two-noun closed line as gone", () => {
    for (const line of [
      "This job posting is no longer available.",
      "This job opening is closed.",
      "This job posting has been filled.",
      "Sorry, this job posting is no longer active.",
    ])
      expect(classifyPage(200, `TITLE: Acme\n\nTEXT:\n${line}`).state, line).toBe("gone");
  });
});

describe("classifyPage: a job no longer available to some people is still open (#1589)", () => {
  it("keeps a posting that narrowed who may apply", () => {
    for (const t of [
      "This opportunity is no longer available to candidates outside the US.",
      "This position is no longer available to candidates requiring sponsorship.",
      "This role is no longer available for candidates who need a visa.",
      "This role is no longer available to applicants in Colorado.",
      "Note: No longer available to internal candidates.",
    ])
      expect(classifyPage(200, `Senior Designer\n${t}`).state, t).toBe("open");
  });
  it("still closes one that ended", () => {
    for (const t of ["This position is no longer available.", "This role is no longer available to apply.", "Sorry, no longer available."])
      expect(classifyPage(200, `Senior Designer\n${t}`).state, t).toBe("gone");
  });
});

describe("classifyPage: a duty about a closed-job screen is not the posting closing (#1591)", () => {
  it("keeps a job-board posting that describes such screens", () => {
    for (const t of [
      "Redesign the page that tells seekers this job has expired.",
      "Make sure a listing is no longer live once the role is filled, and tell candidates.",
      "You'll own the page where a job posting has expired and help users renew it.",
      "Build the banner that shows this position is no longer available, with similar roles below.",
    ])
      expect(classifyPage(200, `Product Designer, Jobs\n${t}`).state, t).toBe("open");
  });
  it("still closes the page's own message", () => {
    for (const t of ["This job has expired.", "This position is no longer available.", "Sorry, this job is closed.", "We're sorry, this listing is no longer active."])
      expect(classifyPage(200, `Product Designer\n${t}`).state, t).toBe("gone");
  });
});

describe("classifyPage: a closed message quoted as copy to write is not the posting closing (#1620)", () => {
  it("stays open when the phrase is quoted or given as an example", () => {
    for (const text of [
      "Content Designer. Write error messages like 'This job is no longer available'.",
      'Write the copy for screens such as "This position has been filled".',
      'Rewrite "Page not found" and "This job has expired" across the careers site.',
      "Own the empty states, like “This posting has expired”, for job seekers.",
      "Write the messages job seekers see, such as this job is no longer available, in plain words.",
    ])
      expect(classifyPage(200, text).state, text).toBe("open");
  });
  it("still closes on the page's own message", () => {
    for (const text of [
      "Sorry, this job is no longer available.",
      "Sorry! It seems like this position has been filled.",
      "Content Designer\nIt looks like this job is no longer available.",
      "Content Designer\nThis position has been filled. Browse other jobs like this one.",
    ])
      expect(classifyPage(200, text).state, text).toBe("gone");
  });
});

describe("past-tense closed wordings (#1692)", () => {
  it("reads 'the job you were looking for' as closed", () => {
    for (const msg of [
      "The page you were looking for doesn't exist.",
      "Sorry, the page you were looking for could not be found.",
      "The job you were looking for could not be found.",
      "The job you were looking for is no longer available.",
      "The job you were looking for has been filled.",
      "The position you were looking for has been removed.",
    ])
      expect(classifyPage(200, `Acme Careers\n${msg}\nSearch all jobs`).state, msg).toBe("gone");
  });

  it("still keeps a duty about such a page open", () => {
    const text = "Content Designer\nWrite microcopy for empty states and the screen that says the page you were looking for doesn't exist.";
    expect(classifyPage(200, text).state).toBe("open");
  });
});
