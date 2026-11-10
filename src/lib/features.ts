/**
 * Server switches for features that are on staging but not ready for prod (#343).
 * Each is off unless the server's .env sets it to "on", so prod stays as it was until Eric turns one on.
 * - FEATURE_EVENTS: the Events page, its API, and event searches inside scheduled runs (#7, #264, #265).
 * - FEATURE_SEARCHES: more than one search per account, the search switcher, and the kind picker at sign-up (#8).
 * - FEATURE_PREVIEW: the /next page that shows features still being built, for demos (#602). Turn it off after.
 */
export type Feature = "EVENTS" | "SEARCHES" | "PREVIEW";

export const featureOn = (name: Feature) => process.env[`FEATURE_${name}`] === "on";
