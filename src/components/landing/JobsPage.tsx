import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { NEXT_MOVES } from "@/lib/onboarding";
import { Clip, Playable } from "./Motion";
import { FinalCta, joinHref, SiteFooter, SiteHeader } from "./Site";
import s from "./landing.module.css";

/**
 * /jobs (#9): the job search in more detail than the home page. Every claim here is something the app
 * does today (see README > How a search works). Screens are the made-up Maya Ortiz demo account.
 */
export function JobsPage({ inviteOnly, channel }: { inviteOnly: boolean; channel: string | null }) {
  const n = BRAND.name;
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <SiteHeader inviteOnly={inviteOnly} channel={channel} pages />
        <main>
          <section className={s.hero}>
            <div className={s.heroText}>
              <div className={s.eyebrow}>Jobs</div>
              <h1 className={s.h1}>It reads the posting. All of it.</h1>
              <p className={s.lede}>
                Titles lie. A &ldquo;Senior Designer&rdquo; role can be a team lead or a junior seat with a big title. {n} opens every posting, reads the whole
                thing, and scores it against what you actually want.
              </p>
              <div className={s.ctas}>
                <Link href={joinHref(channel)} className={s.btn}>{inviteOnly ? "Join the waitlist" : "Get started"}</Link>
                <Link href="/what-it-finds" className={s.btnGhost}>What else it finds</Link>
              </div>
            </div>
            <div className={s.shot} aria-hidden>
              <Image src="/landing/board-desktop.jpg" alt="" width={1600} height={1000} priority sizes="(max-width: 960px) 100vw, 620px" />
            </div>
          </section>

          <section className={s.section}>
            <div className={s.eyebrow}>Who it&apos;s for</div>
            <h2 className={s.h2}>People who know what they want next.</h2>
            <p className={s.sub}>The first question is where you&apos;re headed. Everything after that is scored against it.</p>
            <ul className={s.list}>
              {NEXT_MOVES.map((m) => (
                <li key={m.key}>{m.label}</li>
              ))}
            </ul>
          </section>

          <section className={s.section}>
            <div className={s.eyebrow}>How a search works</div>
            <h2 className={s.h2}>What happens on every search.</h2>
            <div className={s.cards}>
              <Card title="It writes the searches">From your answers and your resume, it writes a handful of searches you&apos;d never have time to run.</Card>
              <Card title="It looks where jobs are">Job boards and company career pages. Roles already on your board are skipped.</Card>
              <Card title="It reads each one">The full posting, not the title and a snippet. Pay, location and level come from the page itself.</Card>
              <Card title="It scores it">A 1 to 5 match and the reasons, in plain words. You can see why a role ranked where it did.</Card>
              <Card title="It follows your rules">A dealbreaker never makes the board. Under your pay floor or off on location, it&apos;s marked down, not hidden.</Card>
              <Card title="It shows its work">After each search: what it looked at, what it threw out and why, and a tip when your answers are too narrow.</Card>
            </div>
          </section>

          <section className={s.section}>
            <div className={`${s.split} ${s.splitFlip}`}>
              <Playable className={s.shot}>
                <Clip src="/landing/how-decide.mp4" poster="/landing/how-decide.jpg" label="Turning on the pay filter, archiving two low matches and pinning a strong one." />
              </Playable>
              <div>
                <div className={s.eyebrow}>Your board</div>
                <h2 className={s.h2}>One list, best match first.</h2>
                <ul className={s.list}>
                  <li>Pin the good ones, archive the rest, move roles through stages as you apply.</li>
                  <li>Say why something&apos;s not a fit. The next search knows.</li>
                  <li>A weekly email with the new finds, if you want one.</li>
                  <li>Export the whole board any time.</li>
                </ul>
              </div>
            </div>
          </section>

          <FinalCta inviteOnly={inviteOnly} channel={channel} title="Stop refreshing job boards." />
        </main>
        <SiteFooter pages />
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={s.card}>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
