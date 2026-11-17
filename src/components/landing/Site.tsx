import Link from "next/link";
import { LegalLinks } from "@/components/LegalLinks";
import { BRAND } from "@/lib/brand";
import { font } from "@/lib/tokens";
import s from "./landing.module.css";

/** Where the call to action goes, keeping a channel test's ?ref= (#527). */
export const joinHref = (channel: string | null) => (channel ? `/request-access?ref=${encodeURIComponent(channel)}` : "/request-access");

/**
 * The marketing site's top bar (#600, #9). `pages` adds the Jobs and "What it finds" links (FEATURE_WAITLIST).
 * `inviteOnly` picks the button label: during testing it's a waitlist, later it's a sign-up.
 */
export function SiteHeader({ inviteOnly, channel, pages, howHref = "#how" }: { inviteOnly: boolean; channel: string | null; pages: boolean; howHref?: string }) {
  return (
    <header className={s.nav}>
      <Link href="/" className="wordmark" style={{ fontSize: font["3xl"], color: "#1D1A0F", textDecoration: "none" }}>{BRAND.name}</Link>
      <nav className={s.navLinks} aria-label="Site">
        {pages ? (
          <>
            <Link href="/jobs" className={s.hideSm}>Jobs</Link>
            <Link href="/what-it-finds" className={s.hideSm}>What it finds</Link>
          </>
        ) : (
          <a href={howHref} className={s.hideSm}>How it works</a>
        )}
        <Link href="/signin">Sign in</Link>
        <Link href={joinHref(channel)} className={s.navCta}>{inviteOnly ? (pages ? "Join the waitlist" : "Request access") : "Get started"}</Link>
      </nav>
    </header>
  );
}

export function SiteFooter({ pages = false }: { pages?: boolean }) {
  return (
    <footer className={s.foot}>
      <span>
        {BRAND.name} is built by <a href={BRAND.maker.url}>{BRAND.maker.name}</a>.
      </span>
      {pages && (
        <nav aria-label="Pages" style={{ display: "flex", gap: 16 }}>
          <Link href="/">Home</Link>
          <Link href="/jobs">Jobs</Link>
          <Link href="/what-it-finds">What it finds</Link>
        </nav>
      )}
      <LegalLinks />
    </footer>
  );
}

/** The closing call to action every marketing page ends on. */
export function FinalCta({ inviteOnly, channel, title = "Let's find it." }: { inviteOnly: boolean; channel: string | null; title?: string }) {
  return (
    <section className={s.final}>
      <h2 className={s.h2} style={{ maxWidth: "12em" }}>{title}</h2>
      <p className={s.sub}>Free while {BRAND.name} is in testing.</p>
      <Link href={joinHref(channel)} className={s.finalBtn}>{inviteOnly ? "Join the waitlist" : "Get started"}</Link>
    </section>
  );
}
