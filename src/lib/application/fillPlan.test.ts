import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checksBox, CONFIRMATION, pickOne, pickOptions, planFill, sameOption, uploadLabels } from "./fillPlan";

const item = (o: Partial<Parameters<typeof planFill>[0][number]>) => ({ id: "i", kind: "answer" as const, prompt: "Q", required: true, fieldType: "text", options: null, approvedVersionId: null, ...o });

describe("planFill", () => {
  it("uploads resume and cover letter, picks choices, types the rest, skips unapproved and outreach", () => {
    const steps = planFill(
      [
        item({ id: "1", kind: "resume", prompt: "Resume/CV", approvedVersionId: "v1" }),
        item({ id: "2", kind: "cover_letter", prompt: "Cover Letter", required: false, approvedVersionId: null }),
        item({ id: "3", prompt: "Sponsorship?", options: ["Yes", "No"], approvedVersionId: "v3" }),
        item({ id: "4", kind: "field", prompt: "Email", approvedVersionId: "v4" }),
        item({ id: "5", kind: "outreach", prompt: "Maya Ortiz · Recruiter", required: false, approvedVersionId: "v5" }),
      ],
      [
        { id: "v1", content: "# Maya" },
        { id: "v3", content: "No" },
        { id: "v4", content: "maya@example.com" },
        { id: "v5", content: "Hi Maya, I'm applying…" },
      ],
    );
    expect(steps.map((s) => [s.prompt, s.kind, s.content])).toEqual([
      ["Resume/CV", "file", "# Maya"],
      ["Sponsorship?", "choice", "No"],
      ["Email", "text", "maya@example.com"],
    ]);
  });

  it("skips a cover letter the published form never listed, keeping the resume and other uploads (#1210)", () => {
    const items = [
      item({ id: "1", kind: "resume", prompt: "Resume/CV", approvedVersionId: "v1" }),
      item({ id: "2", kind: "cover_letter", prompt: "Cover letter", required: false, approvedVersionId: "v2" }),
      item({ id: "3", kind: "portfolio", prompt: "Transcript", required: false, fieldType: "file", approvedVersionId: "v3" }),
    ];
    const versions = [
      { id: "v1", content: "# Maya" },
      { id: "v2", content: "Dear team" },
      { id: "v3", content: "A+" },
    ];
    expect(planFill(items, versions, { skipLetter: true }).map((s) => s.itemKind)).toEqual(["resume", "portfolio"]);
    expect(planFill(items, versions).map((s) => s.itemKind)).toEqual(["resume", "cover_letter", "portfolio"]);
  });
});

describe("pickOptions (#165)", () => {
  const work = [
    "Yes, and I will not require employer support for employment visa status now or in the future for continued employment.",
    "Yes, but I will require employer support for employment visa status in the future for continued employment (if you are currently on H-1B, TN, E-3, or O-1 you will select this answer.)",
    "No, and I will require employer support for employment visa status in the future for continued employment.",
  ];
  it("matches the exact option text", () => {
    expect(pickOptions(work[0], work)).toEqual([work[0]]);
  });
  it("ticks several options, one per line, ignoring case and extra spaces", () => {
    expect(pickOptions(`${work[0].toUpperCase()}\n\n  ${work[2]}  `, work)).toEqual([work[0], work[2]]);
  });
  it("accepts an answer cut short, and drops lines that match nothing", () => {
    expect(pickOptions("Yes, but I will require employer support\nMaybe", work)).toEqual([work[1]]);
  });
  it("picks the closest option, not the first that shares a prefix (#632)", () => {
    expect(pickOptions("None", ["No", "None of the above"])).toEqual(["None of the above"]);
    expect(pickOptions("JavaScript (ES6)", ["Java", "JavaScript"])).toEqual(["JavaScript"]);
    expect(pickOptions("Yes, I am authorized", ["Yes", "No"])).toEqual(["Yes"]);
  });
  it("matches a prefix only at a word boundary (#632)", () => {
    expect(pickOptions("Nonprofit", ["No", "Yes"])).toEqual([]);
  });
  it("uses the answer as-is when the question listed no options", () => {
    expect(pickOptions("Remote", [])).toEqual(["Remote"]);
  });
});

describe("planFill options", () => {
  it("carries a choice item's options to the browser step", () => {
    const [s] = planFill([item({ id: "1", prompt: "Work authorization", options: ["Yes", "No"], approvedVersionId: "v1" })], [{ id: "v1", content: "Yes" }]);
    expect(s.options).toEqual(["Yes", "No"]);
  });
});

describe("checksBox (#669)", () => {
  it("ticks on yes, true and the consent verbs, alone or leading the answer", () => {
    for (const a of ["yes", "Yes", "TRUE", "agree", "I agree", "I acknowledge", "I confirm", "I consent", "I certify the above is true", "Accept", "Yes, I agree", "yes - happy to", "  yes  "]) expect(checksBox(a), a).toBe(true);
  });
  it("ticks on past tense and read-and-agree answers (#681)", () => {
    for (const a of ["Agreed", "Acknowledged.", "Confirmed", "Accepted", "Consented", "Certified", "I have read and agree", "I've read and acknowledge", "I’ve read and acknowledge", "I read and agree", "I understand and agree", "I understand", "I agreed to the terms"]) expect(checksBox(a), a).toBe(true);
  });
  it("ticks on read-and-understand answers (#796)", () => {
    for (const a of ["I have read and understand the privacy policy", "I've read and understood", "I’ve read and understood the terms", "I read and understand", "I understood"]) expect(checksBox(a), a).toBe(true);
    for (const a of ["I have read and do not understand", "I have read and do not agree"]) expect(checksBox(a), a).toBe(false);
  });
  it("ticks on hereby, a bare understood and read-and-agreed (#899)", () => {
    for (const a of ["I hereby agree", "I hereby certify that the information above is true", "I hereby acknowledge", "Understood", "Understood.", "Read and agreed", "Read and understood"]) expect(checksBox(a), a).toBe(true);
    for (const a of ["I hereby decline", "Understanding pending", "Read and declined", "I hereby do not agree"]) expect(checksBox(a), a).toBe(false);
  });
  it("ticks on authorize, attest and affirm (#911)", () => {
    for (const a of ["I authorize", "I authorise", "I attest", "I affirm", "Authorized", "I authorize Acme to conduct a background check", "I hereby attest that the above is true", "I affirm the information is accurate"]) expect(checksBox(a), a).toBe(true);
    for (const a of ["I do not authorize", "Authorization pending", "Affirmative action statement"]) expect(checksBox(a), a).toBe(false);
  });

  it("ticks for a read-and-understood list, a review, a declaration and a given consent (#1824)", () => {
    for (const a of ["I have read, understood and agree", "I have read, understood, and agree to the terms", "I've read, understood and accept", "Read, understood and agreed", "I have reviewed and agree", "Reviewed and understood", "I declare", "I hereby declare that the above is true", "Declared", "I give my consent", "I give consent", "I hereby give my consent"]) expect(checksBox(a), a).toBe(true);
    for (const a of ["I have read the privacy notice", "I have read, understood and do not agree", "I have reviewed the terms", "I give up", "Declaration pending"]) expect(checksBox(a), a).toBe(false);
  });
  it("leaves the box on no, empty or anything else", () => {
    for (const a of ["", "No", "false", "No, I do not agree", "I do not agree", "I don't consent", "Yesterday", "Agreement pending", "N/A", "Maybe", "I have read the terms", "I do not understand", "Disagreed", "Acceptance pending"]) expect(checksBox(a), a).toBe(false);
  });
});

describe("blank options (#722)", () => {
  it("never prefix-match an answer that starts with a symbol", () => {
    expect(pickOne("$185,000", ["  ", "$100,000 - $150,000", "$150,000+"])).toBe(-1);
    expect(pickOptions("(none)", [" ", "Figma"])).toEqual([]);
    expect(pickOne("$150,000+", ["", "$150,000+"])).toBe(1);
    // #1255
    expect(pickOne("I don't wish to answer", ["Yes", "No", "I don’t wish to answer"])).toBe(2);
    expect(pickOne("I don’t know", ["Yes", "No", "I don't know"])).toBe(2);
    expect(pickOptions("Women’s network\n“Other”", ["Women's network", "\"Other\"", "None"])).toEqual(["Women's network", "\"Other\""]);
  });
});

describe("dashes (#1277)", () => {
  it("an en or em dash in an option matches a hyphen in the answer, and the reverse", () => {
    const race = ["White – A person having origins in any of the original peoples of Europe", "Hispanic or Latino – A person of Cuban, Mexican or other Spanish culture"];
    expect(pickOne("Hispanic or Latino - A person of Cuban, Mexican or other Spanish culture", race)).toBe(1);
    expect(pickOne("Yes - I am authorized to work in the US", ["Yes—I am authorized to work in the US", "No—I am not authorized"])).toBe(0);
    expect(pickOptions("Full-time – onsite", ["Full-time - onsite", "Part-time - remote"])).toEqual(["Full-time - onsite"]);
  });
});

describe("pickOne (#695)", () => {
  const long = "I acknowledge that I have read and understood the privacy notice for job applicants in the United States";
  it("takes exact text, then a word-boundary prefix either way, then a long label by its first 80 characters", () => {
    expect(pickOne("Yes", ["Select", "Yes", "No"])).toBe(1);
    expect(pickOne("yes ", ["Select", "Yes", "No"])).toBe(1);
    expect(pickOne("Yes, I am authorized to work in the US", ["Select", "Yes", "No"])).toBe(1);
    expect(pickOne("No", ["Select", "None of the above", "No, I do not have a disability"])).toBe(2);
    expect(pickOne("None", ["No", "None of the above"])).toBe(1);
    expect(pickOne(`${long}.`, ["Select", `${long} (2026 edition)`])).toBe(1);
  });
  it("matches the same text written with or without hyphens, spaces or an apostrophe (#1518)", () => {
    expect(pickOne("Full time", ["Select", "Full-time", "Part-time"])).toBe(1);
    expect(pickOne("Onsite", ["Remote", "Hybrid", "On-site"])).toBe(2);
    expect(pickOne("Bachelors", ["Associate's", "Bachelor's", "Master's"])).toBe(1);
    expect(pickOne("Nonbinary", ["Man", "Woman", "Non-binary"])).toBe(2);
    expect(pickOne("Part time ✱", ["Full-time", "Part-time"])).toBe(1);
    expect(pickOptions("Full time\nContract", ["Full-time", "Part-time", "Contract"])).toEqual(["Full-time", "Contract"]);
    // Whole text only: "No" is still not "None".
    expect(pickOne("No", ["None", "Yes"])).toBe(-1);
  });
  it("never joins two numbers into one: '12' is not the '1-2' range (#1549)", () => {
    expect(pickOne("12 years", ["Less than 1 year", "1-2 years", "3-5 years", "6-10 years", "10+ years"])).toBe(-1);
    expect(sameOption("12", ["0-1", "1-2", "3-5", "6-10", "10+"])).toBeUndefined();
    expect(sameOption("12 weeks", ["Immediately", "1-2 weeks", "1 month"])).toBeUndefined();
    expect(sameOption("15", ["1.5", "2"])).toBeUndefined();
    expect(pickOptions("15 years", ["1-5 years", "6-10 years", "11-15 years", "15+ years"])).not.toContain("1-5 years");
    // A range still lands on itself however it's spaced.
    expect(pickOne("1 - 2 years", ["Less than 1 year", "1-2 years", "3-5 years"])).toBe(1);
    expect(pickOne("3–5 years", ["1-2 years", "3-5 years"])).toBe(1);
  });
  it("is -1 when no option fits", () => {
    expect(pickOne("They/them", ["She/her", "He/him"])).toBe(-1);
    expect(pickOne("Maybe", ["Yes", "No"])).toBe(-1);
    expect(pickOne("Yes", [])).toBe(-1);
  });
});

describe("CONFIRMATION (#692, #748, #762)", () => {
  it("reads the usual thank-you pages as sent", () => {
    for (const t of [
      "Thank you for applying!",
      "Thanks for applying to Acme",
      "Thanks for your application. We'll be in touch.",
      "Thank you for submitting your application",
      "Application submitted!",
      "Your application has been received",
      "Your application was successfully submitted.",
      "Application sent",
      "We have successfully received your application",
      "We’ve received your application",
      "You have successfully applied for this position",
      // #748
      "Thanks for your interest! We received your application.",
      "Thank you for your submission",
      "Thanks, we got your application!",
      // #762
      "Your submission has been received",
      "We have received your submission.",
      "Your application for Senior Product Designer has been received",
      "Your application for the role was successfully submitted",
      "Your candidacy has been submitted",
      // innerText can run inline text together.
      "Submit applicationThank you for applying",
      // #844: a later sentence still counts.
      "Once you applied, we said we'd write. Your application has been received.",
      "Thank you! Your application has been submitted.",
      // #886: a negation earlier in the line doesn't hide a real confirmation.
      "Don't close this page yet. You have successfully applied.",
      "Not what you expected? You have successfully submitted your application.",
      // #1154
      "Your application to Acme has been submitted.",
      "Your application with Acme has been received!",
      // #1452: Workday-style thank-you pages.
      "You have submitted your application",
      "You've submitted your application for Senior Designer.",
      "You’ve submitted your application.",
      // #1621
      "Success! Your application is complete.",
      "Application complete",
      "Your application is complete. We'll be in touch.",
      "Thank you! Your application has been completed.",
      // #1647
      "Submission complete",
      "Your submission is complete.",
      "Your submission has been completed.",
      "Your application has been successfully completed.",
      "Applied successfully!",
      // #1728
      "You have successfully completed the application",
      "You've successfully completed your application.",
      "Your application is in!",
      "Your application is in.",
      "Thank-you for applying",
      "Thankyou for applying",
      "Thanks! Your resume has been submitted.",
      "Your CV was submitted",
      // #1802: a "could not" elsewhere on the page, or in an earlier sentence, does not undo the confirmation
      "We could not be happier to hear from you. Your application has been received.",
      "Thank you, your application has been received. If we cannot verify your details, we will email you.",
      // #1777
      "Success! You've applied.",
      "You have applied to Acme.",
      "You’ve applied for Product Designer!",
      "You have now applied",
    ])
      expect(CONFIRMATION.test(t), t).toBe(true);
  });
  it("does not read a form page as sent", () => {
    for (const t of [
      "Thank you for your interest in joining our team. Please complete the form below.",
      "Thank you",
      "Submit application",
      "Apply for this job",
      "Before your application is submitted, review your answers.",
      "Application questions",
      "Once we receive your application, we will review it.",
      // #762
      "Your application for this role will be reviewed once it is submitted.",
      "Before your submission is sent, check your answers.",
      // #844
      "Once your application has been received, we will review it.",
      "After you have successfully submitted your application, you will get an email.",
      "When your application has been submitted, a recruiter will reach out.",
      "If your application was received, you will get an email within a day.",
      "Upon successfully submitting, you'll see a summary.",
      "We will contact you after your application has been received.",
      // #886: a failed submit says it didn't go through.
      "Your application was not successfully submitted. Please correct the errors below.",
      "Your application could not be successfully submitted.",
      "Your application couldn't be successfully submitted.",
      "You have not successfully applied yet.",
      "You have never successfully applied for this role.",
      "Your application has not been successfully submitted.",
      // #1115: "unsuccessfully" is a failed submit too.
      "Your application was unsuccessfully submitted.",
      "Application unsuccessfully submitted, please try again",
      // #1154
      "Your application has not yet been successfully submitted.",
      "Your application hasn't yet been successfully submitted.",
      "No application has been submitted yet.",
      "Once your application to Acme has been received, we will review it.",
      // #1452
      "Once you have submitted your application, we will email you.",
      "Have you submitted your application yet?",
      "You have not submitted your application.",
      // #1621
      "Once your application is complete, click Submit.",
      "Your application is incomplete.",
      "Make sure your application is complete before you submit.",
      "Please check that your application is complete.",
      "Application complete: 80%",
      "Your application is not complete.",
      // #1647
      "Your submission is not complete.",
      "Please complete your submission.",
      "Make sure your submission is complete.",
      "Submission complete: 2 of 5 steps",
      "You have not applied successfully.",
      // #1728
      "Make sure your application is in by Friday.",
      "Make sure your application is in.",
      "Your application is in progress.",
      "Once you have successfully completed the application, we will review it.",
      "Have you successfully completed your application?",
      "You have not successfully completed the application.",
      "Your resume was received",
      "Resume uploaded",
      "Your resume has not been submitted",
      // #1777
      "Have you applied to Acme before?",
      "You have applied to this job before.",
      "You've already applied for this role previously.",
      "If you have applied, check your email.",
      "Once you have applied, we will email you.",
      "You have not applied yet.",
      // #1802
      "We could not confirm your application has been received.",
      "We couldn't verify that your application was submitted. Please try again.",
      "We were unable to confirm that your application was received",
      "The site failed to confirm your submission was received.",
      "We can't tell if your application was sent.",
    ])
      expect(CONFIRMATION.test(t), t).toBe(false);
  });
  it("is the same pattern the extension scripts use", () => {
    for (const f of ["fill.js", "background.js"]) {
      const src = readFileSync(path.resolve(__dirname, "../../../extension/firefox", f), "utf8");
      expect(src, f).toContain(`const THANKS = /${CONFIRMATION.source}/i;`);
    }
  });
});

describe("uploadLabels (#918)", () => {
  const f = (itemKind: string, prompt: string, kind = "file") => ({ itemKind, prompt, kind }) as Parameters<typeof uploadLabels>[0][number];
  it("gives a portfolio upload its own name so it can't overwrite the resume", () => {
    expect(uploadLabels([f("resume", "Resume/CV"), f("answer", "Portfolio"), f("field", "Phone", "text"), f("answer", "Writing sample")])).toEqual(["Resume", "Portfolio", null, "Writing sample"]);
  });
  it("numbers a repeat, like two cover letter items", () => {
    expect(uploadLabels([f("resume", "Resume"), f("cover_letter", "Cover letter"), f("cover_letter", "Additional letter"), f("answer", "Cover Letter")])).toEqual(["Resume", "Cover Letter", "Cover Letter 2", "Cover Letter 3"]);
  });
  it("strips characters a file name can't carry and falls back when nothing is left", () => {
    expect(uploadLabels([f("answer", "Portfolio / work samples?"), f("answer", "***")])).toEqual(["Portfolio work samples", "Document"]);
  });
  it("never hands out a label twice, even when a prompt already ends in a number (#1378)", () => {
    expect(uploadLabels([f("answer", "Attachment"), f("answer", "Attachment"), f("answer", "Attachment 2")])).toEqual(["Attachment", "Attachment 2", "Attachment 2 2"]);
    expect(uploadLabels([f("answer", "Attachment 2"), f("answer", "Attachment"), f("answer", "Attachment")])).toEqual(["Attachment 2", "Attachment", "Attachment 3"]);
    expect(uploadLabels([f("answer", "attachment"), f("answer", "Attachment")])).toEqual(["attachment", "Attachment 2"]);
  });
  it("keeps accented letters in a label (#1198)", () => {
    expect(uploadLabels([f("answer", "Carta de presentación"), f("answer", "Échantillon d'écriture")])).toEqual(["Carta de presentación", "Échantillon d écriture"]);
  });
});

describe("options with a required mark (#1061)", () => {
  it("matches \"Yes*\" the way the extension does", () => {
    expect(pickOne("Yes, I am authorized", ["Yes*", "No*"])).toBe(0);
    expect(pickOptions("Spanish\nFrench", ["English*", "Spanish*", "French*"])).toEqual(["Spanish*", "French*"]);
  });
});
