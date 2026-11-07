// Versions of the documents people agree to at sign-up (#21). Bump a version when its page
// changes in a way people should agree to again; everyone is asked again on their next visit.

/** The privacy page's "Last updated" date (YYYY-MM-DD). The page shows this date. */
export const PRIVACY_VERSION = "2026-11-07";

/** The Terms page's "Last updated" date (YYYY-MM-DD, #20). The page shows this date. */
export const TERMS_VERSION = "2026-11-07";

type Accepted = { termsVersion: string | null; privacyVersion: string | null };

/** True when the person hasn't agreed to the current version of every document. */
export function needsConsent(u: Accepted, terms = TERMS_VERSION, privacy = PRIVACY_VERSION) {
  return u.privacyVersion !== privacy || u.termsVersion !== terms;
}

/** What gets stored when someone ticks the box. */
export const acceptedNow = () => ({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, acceptedAt: new Date() });

/** "November 7, 2026" from "2026-11-07", for the page's "Last updated" line. */
export function versionDate(v: string) {
  return new Date(`${v}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The email notice on the request-access form (#28). Bump the version when the wording changes,
 * so each waitlist row records what that person was told.
 */
export const WAITLIST_NOTICE_VERSION = "2026-11-07";
export const WAITLIST_NOTICE = "We'll email you about your invite and, now and then, news about Lookout. Every email has an unsubscribe link.";
