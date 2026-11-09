import { color } from "@/lib/tokens";
export const LINK_KINDS = ["Website", "Portfolio", "Behance", "Dribbble", "Instagram", "LinkedIn", "TikTok", "X", "YouTube", "GitHub", "Bluesky", "Threads", "Mastodon", "Substack", "Press", "Other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

// Platforms are matched on the host only, so a portfolio page about Instagram stays "Website" (#496).
const ON: [LinkKind, RegExp][] = [
  ["Instagram", /(^|\.)(instagram\.com|instagr\.am)$/],
  ["TikTok", /(^|\.)tiktok\.com$/],
  ["X", /(^|\.)(twitter\.com|x\.com)$/],
  ["GitHub", /(^|\.)github\.(com|io)$/],
  ["YouTube", /(^|\.)(youtube\.com|youtu\.be)$/],
  ["Behance", /(^|\.)behance\.net$/],
  ["Dribbble", /(^|\.)dribbble\.com$/],
  ["LinkedIn", /(^|\.)(linkedin\.com|lnkd\.in)$/],
  ["Bluesky", /(^|\.)bsky\.app$/],
  ["Threads", /(^|\.)threads\.(net|com)$/],
  ["Substack", /(^|\.)substack\.com$/],
  ["Portfolio", /(^|\.)(squarespace\.com|wixsite\.com|wix\.com|format\.com|cargo\.site)$/],
];

// Mastodon has no single domain: match a /@user profile on the big instances (or any host named mastodon.* / mstdn.*).
// Other instances stay "Website" and can be relabeled in the picker.
const MASTODON = /(^|\.)(mastodon\.[a-z.]+|mstdn\.[a-z.]+|mas\.to|hachyderm\.io|fosstodon\.org|infosec\.exchange|techhub\.social|sfba\.social)$/;

function parts(u: string) {
  try {
    const url = new URL(hrefOf(u.trim()));
    return { host: url.hostname.toLowerCase().replace(/^www\./, ""), path: url.pathname };
  } catch {
    return { host: "", path: "" };
  }
}

export const linkKind = (u: string): LinkKind => {
  const { host, path } = parts(u);
  if (!host) return "Website";
  const hit = ON.find(([, re]) => re.test(host));
  if (hit) return hit[0];
  return MASTODON.test(host) && /^\/@\w/.test(path) ? "Mastodon" : "Website";
};

export const LINK_TILE: Record<string, [string, string]> = {
  Instagram: ["#F8A865", "#1D1A0F"], TikTok: ["#1D1A0F", "#fff"], X: ["#1D1A0F", "#fff"], GitHub: ["#1D1A0F", "#fff"],
  YouTube: ["#99220F", "#fff"], Portfolio: ["#4B2310", "#fff"], Behance: ["#1D1A0F", "#fff"], Dribbble: ["#F8A865", "#1D1A0F"],
  LinkedIn: ["#4B2310", "#fff"], Bluesky: ["#FDE7D3", "#7A3A10"], Threads: ["#1D1A0F", "#fff"], Mastodon: ["#4B2310", "#fff"],
  Substack: ["#F8A865", "#1D1A0F"], Press: ["#FDE7D3", "#7A3A10"], Other: [color.border, "#4B2310"], Website: [color.border, "#4B2310"],
};

export const cleanUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
export const hrefOf = (u: string) => (/^https?:\/\//i.test(u) ? u : "https://" + u);
