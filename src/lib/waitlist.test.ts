import { describe, expect, it } from "vitest";
import { CONFIRM_DAYS, confirmEmail, confirmToken, csvCell, readConfirmToken, waitlistCsv } from "./waitlist";

const A = "a".repeat(32);
const B = "b".repeat(32);
const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 17, 12);

describe("waitlist confirm token (#9)", () => {
  it("names the address it was made for", () => {
    expect(readConfirmToken(confirmToken(A, "maya@example.com", now), [A], now)).toBe("maya@example.com");
  });

  it("still works with the previous secret during a rotation, and not with an unknown one", () => {
    const t = confirmToken(A, "maya@example.com", now);
    expect(readConfirmToken(t, [B, A], now)).toBe("maya@example.com");
    expect(readConfirmToken(t, [B], now)).toBeNull();
  });

  it("refuses a changed address, day or signature", () => {
    const [, day, sig] = confirmToken(A, "maya@example.com", now).split(".");
    const other = Buffer.from("lee@example.com").toString("base64url");
    expect(readConfirmToken(`${other}.${day}.${sig}`, [A], now)).toBeNull();
    expect(readConfirmToken(confirmToken(A, "maya@example.com", now).replace(`.${day}.`, `.${Number(day) + 1}.`), [A], now + DAY)).toBeNull();
    expect(readConfirmToken("junk", [A], now)).toBeNull();
    expect(readConfirmToken("", [A], now)).toBeNull();
  });

  it(`expires after ${CONFIRM_DAYS} days`, () => {
    const t = confirmToken(A, "maya@example.com", now);
    expect(readConfirmToken(t, [A], now + CONFIRM_DAYS * DAY)).toBe("maya@example.com");
    expect(readConfirmToken(t, [A], now + (CONFIRM_DAYS + 1) * DAY)).toBeNull();
  });

  it("the email carries the link in both parts and escapes it in HTML", () => {
    const m = confirmEmail("maya@example.com", "https://x.test/waitlist/confirm?t=a&b");
    expect(m.text).toContain("https://x.test/waitlist/confirm?t=a&b");
    expect(m.html).toContain("https://x.test/waitlist/confirm?t=a&amp;b");
    expect(m.subject).toMatch(/waitlist/);
  });
});

describe("waitlist CSV (#9)", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
  });

  it("defuses cells a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@me")).toBe("'@me");
  });

  it("has a header row and one line per request", () => {
    const csv = waitlistCsv([
      { email: "maya@example.com", status: "pending", kind: "job", nextMove: "step_up", searchFor: "Design, lead", channel: "hn", createdAt: new Date(now), confirmedAt: null, consentVersion: "2026-11-17" },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "email,status,confirmed_at,joined_at,kind,next_move,search_for,channel,consent_version",
      'maya@example.com,pending,,2026-11-17T12:00:00.000Z,job,step_up,"Design, lead",hn,2026-11-17',
      "",
    ]);
  });
});
