export const LINK_KINDS = ["Website", "Portfolio", "Behance", "Dribbble", "Instagram", "LinkedIn", "TikTok", "X", "YouTube", "GitHub", "Bluesky", "Threads", "Mastodon", "Substack", "Press", "Other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

// Mastodon has no single domain: match a /@user profile on the big instances (or any host named mastodon.* / mstdn.*).
// Other instances stay "Website" and can be relabeled in the picker.
const MASTODON = /(^|[/.])(mastodon\.[a-z.]+|mstdn\.[a-z.]+|mas\.to|hachyderm\.io|fosstodon\.org|infosec\.exchange|techhub\.social|sfba\.social)\/@\w/i;

export const linkKind = (u: string): LinkKind =>
  /instagram/i.test(u) ? "Instagram"
  : /tiktok/i.test(u) ? "TikTok"
  : /(twitter\.com|\bx\.com)/i.test(u) ? "X"
  : /github/i.test(u) ? "GitHub"
  : /youtube|youtu\.be/i.test(u) ? "YouTube"
  : /behance/i.test(u) ? "Behance"
  : /dribbble/i.test(u) ? "Dribbble"
  : /linkedin/i.test(u) ? "LinkedIn"
  : /(^|[/.])bsky\.app\b/i.test(u) ? "Bluesky"
  : /(^|[/.])threads\.(net|com)\b/i.test(u) ? "Threads"
  : MASTODON.test(u) ? "Mastodon"
  : /(^|[/.])substack\.com\b/i.test(u) ? "Substack"
  : /(squarespace|wix|format\.com|cargo\.site)/i.test(u) ? "Portfolio"
  : "Website";

export const LINK_TILE: Record<string, [string, string]> = {
  Instagram: ["#F8A865", "#1D1A0F"], TikTok: ["#1D1A0F", "#fff"], X: ["#1D1A0F", "#fff"], GitHub: ["#1D1A0F", "#fff"],
  YouTube: ["#99220F", "#fff"], Portfolio: ["#4B2310", "#fff"], Behance: ["#1D1A0F", "#fff"], Dribbble: ["#F8A865", "#1D1A0F"],
  LinkedIn: ["#4B2310", "#fff"], Bluesky: ["#FDE7D3", "#7A3A10"], Threads: ["#1D1A0F", "#fff"], Mastodon: ["#4B2310", "#fff"],
  Substack: ["#F8A865", "#1D1A0F"], Press: ["#FDE7D3", "#7A3A10"], Other: ["#EEEAE4", "#4B2310"], Website: ["#EEEAE4", "#4B2310"],
};

export const cleanUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
export const hrefOf = (u: string) => (/^https?:\/\//i.test(u) ? u : "https://" + u);
