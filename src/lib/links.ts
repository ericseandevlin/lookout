export const LINK_KINDS = ["Website", "Portfolio", "Behance", "Dribbble", "Instagram", "LinkedIn", "TikTok", "X", "YouTube", "GitHub", "Press", "Other"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const linkKind = (u: string): LinkKind =>
  /instagram/i.test(u) ? "Instagram"
  : /tiktok/i.test(u) ? "TikTok"
  : /(twitter\.com|\bx\.com)/i.test(u) ? "X"
  : /github/i.test(u) ? "GitHub"
  : /youtube|youtu\.be/i.test(u) ? "YouTube"
  : /behance/i.test(u) ? "Behance"
  : /dribbble/i.test(u) ? "Dribbble"
  : /linkedin/i.test(u) ? "LinkedIn"
  : /(squarespace|wix|format\.com|cargo\.site)/i.test(u) ? "Portfolio"
  : "Website";

export const LINK_TILE: Record<string, [string, string]> = {
  Instagram: ["#F8A865", "#1D1A0F"], TikTok: ["#1D1A0F", "#fff"], X: ["#1D1A0F", "#fff"], GitHub: ["#1D1A0F", "#fff"],
  YouTube: ["#99220F", "#fff"], Portfolio: ["#4B2310", "#fff"], Behance: ["#1D1A0F", "#fff"], Dribbble: ["#F8A865", "#1D1A0F"],
  LinkedIn: ["#4B2310", "#fff"], Press: ["#FDE7D3", "#7A3A10"], Other: ["#EEEAE4", "#4B2310"], Website: ["#EEEAE4", "#4B2310"],
};

export const cleanUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
export const hrefOf = (u: string) => (/^https?:\/\//i.test(u) ? u : "https://" + u);
