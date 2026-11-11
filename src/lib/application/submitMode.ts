import { detectAts, type Ats } from "./scan";

/**
 * Who presses the final Submit on an application (#187). Eric's call on #29 (2026-11-02): Lookout
 * submits on its own only where the site's terms allow it (Greenhouse, Lever, Ashby); everywhere else
 * Lookout fills the form and the person presses Submit. A CAPTCHA at submit time turns an automatic
 * one into press Submit; Lookout never solves CAPTCHAs. Shown on the find and the review screen
 * before approval so nobody is surprised either way.
 */

export type SubmitMode = { mode: "auto" | "press"; why: string };

/** The server-side Submit for me switch. Off on prod until Eric turns it on. */
export const autoSubmitOn = () => process.env.FEATURE_AUTO_SUBMIT === "on";

export const AUTO_ATS: readonly Ats[] = ["greenhouse", "lever", "ashby"];

export const ATS_NAME: Record<string, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday", smartrecruiters: "SmartRecruiters", other: "company site" };

export const SUBMIT_LABEL: Record<SubmitMode["mode"], string> = {
  auto: "Lookout submits this for you",
  press: "Lookout fills it; you press Submit",
};

export const CAPTCHA_STOP = "The site asked for a CAPTCHA, and Lookout never solves those. Press Submit yourself: open the job with the Lookout extension or use the checklist below.";

export function submitMode(p: { ats?: string | null; url?: string | null; autoSubmit: boolean; captcha?: boolean }): SubmitMode {
  // Before the form is read, the posting URL is the best guess. Company pages that embed Greenhouse
  // read as "company site" here and may turn automatic once Lookout reads the application.
  const ats = p.ats ?? (p.url ? detectAts(p.url).ats : null);
  const name = ats && ats !== "other" ? ATS_NAME[ats] ?? ats : null;
  if (p.captcha) return { mode: "press", why: "The site asked for a CAPTCHA, and Lookout never solves those." };
  if (!ats || !AUTO_ATS.includes(ats as Ats)) {
    if (ats === "workday") return { mode: "press", why: "Workday's terms don't allow automatic applications." };
    if (ats === "smartrecruiters") return { mode: "press", why: "SmartRecruiters' terms are unclear on automatic applications, so you send it." };
    return { mode: "press", why: "Lookout only sends on its own on Greenhouse, Lever and Ashby, where the terms allow it." };
  }
  if (!p.autoSubmit) return { mode: "press", why: `${name} allows automatic sending, but it's turned off for now.` };
  return { mode: "auto", why: `${name} allows automatic applications. After you approve every item, Lookout sends the application for you. If Lookout can't complete the form (a CAPTCHA, a field it can't fill), it sends nothing and you finish it yourself.` };
}
