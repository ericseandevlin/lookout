import { beforeEach, describe, expect, it, vi } from "vitest";

// nodemailer stands in for the SMTP server; only the transport is caught.
const send = vi.fn(async () => ({}));
const createTransport = vi.fn(() => ({ sendMail: send }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

const { emailChangeEmail, emailShell, escapeHtml, inactiveEmail, inviteEmail, magicLinkEmail, sendMail } = await import("./email");

const LINK = "https://lookout.example.com/auth/verify?token=abc&next=/board";
const ESCAPED_LINK = "https://lookout.example.com/auth/verify?token=abc&amp;next=/board";

beforeEach(() => {
  send.mockClear();
  createTransport.mockClear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("escapeHtml", () => {
  it("escapes the five HTML special characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
  });

  it("leaves plain text alone", () => {
    expect(escapeHtml("Pat Lee")).toBe("Pat Lee");
  });
});

describe("emailShell", () => {
  it("escapes the title but not the body", () => {
    const html = emailShell("Hi <b>there</b>", "<p>Body</p>");
    expect(html).toContain("Hi &lt;b&gt;there&lt;/b&gt;");
    expect(html).toContain("<p>Body</p>");
  });
});

describe("account emails", () => {
  const cases = [
    ["sign-in", magicLinkEmail("pat@example.com", LINK), "15 minutes"],
    ["invite", inviteEmail("pat@example.com", LINK, "Sam"), "7 days"],
    ["email change", emailChangeEmail("pat@example.com", LINK), "1 hour"],
    ["inactive account", inactiveEmail("pat@example.com", LINK), "6 months"],
  ] as const;

  it.each(cases)("%s email has the link in text and html, and says when it runs out", (_, m, expiry) => {
    expect(m.to).toBe("pat@example.com");
    expect(m.text).toContain(LINK);
    expect(m.html).toContain(`href="${ESCAPED_LINK}"`);
    expect(m.text).toContain(expiry);
    expect(m.html).toContain(expiry);
  });

  it.each(cases)("%s email has no unsubscribe headers (account mail)", (_, m) => {
    expect(m.headers).toBeUndefined();
  });

  it("escapes the inviter's name in the html and keeps the subject plain text", () => {
    const m = inviteEmail("pat@example.com", LINK, `<img src=x onerror="alert(1)">`);
    expect(m.html).not.toContain("<img");
    expect(m.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; invited you");
    expect(m.subject).toBe(`<img src=x onerror="alert(1)"> invited you to Lookout`);
  });
});

describe("sendMail", () => {
  const mail = magicLinkEmail("pat@example.com", LINK);

  it("drops the mail with a warning when SMTP_URL isn't set", async () => {
    vi.stubEnv("SMTP_URL", "");
    vi.stubEnv("EMAIL_DEV_LOG", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendMail(mail)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("SMTP_URL not set"));
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("prints the mail in dev when EMAIL_DEV_LOG=1", async () => {
    vi.stubEnv("SMTP_URL", "");
    vi.stubEnv("EMAIL_DEV_LOG", "1");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await sendMail(mail);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(LINK));
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends through SMTP with From and Reply-To, and reuses one transport", async () => {
    vi.stubEnv("SMTP_URL", "smtp://user:pass@mail.example.com:587");
    vi.stubEnv("MAIL_FROM", "Lookout <hi@example.com>");
    vi.stubEnv("MAIL_REPLY_TO", "help@example.com");
    await sendMail(mail);
    await sendMail(mail);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith("smtp://user:pass@mail.example.com:587");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ from: "Lookout <hi@example.com>", replyTo: "help@example.com", ...mail });
  });

  it("leaves Reply-To off when there is no reply address or admin", async () => {
    vi.stubEnv("SMTP_URL", "smtp://mail.example.com");
    vi.stubEnv("MAIL_REPLY_TO", "");
    vi.stubEnv("ADMIN_EMAILS", "");
    await sendMail(mail);
    expect(send.mock.calls[0]).toEqual([expect.not.objectContaining({ replyTo: expect.anything() })]);
  });
});
