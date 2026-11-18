import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Clip, FiveQuestions, Playable, ProductVideo } from "./Motion";
import { joinHref, SiteFooter, SiteHeader } from "./Site";
import s from "./landing.module.css";

/**
 * The one-page site at / (#600). Sign-in and request access live on their own pages (/signin, /request-access).
 * Every screen and clip is the real app on a demo account ("Maya Ortiz", made-up companies): no real user data.
 */
export function Landing({ inviteOnly, channel, pages = false }: { inviteOnly: boolean; channel: string | null; pages?: boolean }) {
  // pages: FEATURE_WAITLIST (#9) links the Jobs and "What it finds" pages and calls the list a waitlist.
  const cta = inviteOnly ? (pages ? "Join the waitlist" : "Request access") : "Get started";
  const join = joinHref(channel);
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <SiteHeader inviteOnly={inviteOnly} channel={channel} pages={pages} />

        <main>
          <section className={s.hero}>
            <div className={s.heroText}>
              <div className={s.eyebrow}>In testing · {inviteOnly ? "invite only" : "free"}</div>
              <h1 className={s.h1}>{BRAND.name} searches for jobs so you don&apos;t have to.</h1>
              <p className={s.lede}>
                You answer five questions about what you want. Twice a week, {BRAND.name} searches job boards and company sites, reads each posting, and
                adds the good matches to your board. Each one has a score from 1 to 5 and the reasons.
              </p>
              <div className={s.ctas}>
                <Link href={join} className={s.btn}>{cta}</Link>
                <Link href="/signin" className={s.btnGhost}>Sign in</Link>
              </div>
            </div>
            <div className={s.devices} aria-hidden>
              <div className={s.laptop}>
                <div className={s.chrome}>
                  <i /><i /><i />
                  <span>lookout.ericdevlin.co</span>
                </div>
                <Image src="/landing/board-desktop.jpg" alt="" width={1600} height={1000} priority sizes="(max-width: 960px) 100vw, 620px" />
              </div>
              <div className={s.phone}>
                <Image src="/landing/board-mobile.jpg" alt="" width={600} height={1298} priority sizes="(max-width: 960px) 30vw, 170px" />
              </div>
            </div>
          </section>

          <ProductVideo />

          <section className={s.section} id="how" style={{ scrollMarginTop: 24 }}>
            <div className={s.eyebrow}>How it works</div>
            <h2 className={s.h2}>Set it up once, and it keeps searching.</h2>
            <div className={s.steps}>
              <Step n={1} title="Five questions" media={<FiveQuestions />}>
                The questions cover the role you want next, the lowest pay you&apos;d take, where you want to work, your best result at work, and your
                dealbreakers. You can add your resume too.
              </Step>
              <Step n={2} title="It searches" media={<Clip src="/landing/how-looking.mp4" poster="/landing/how-looking.jpg" label="The board filling with new finds, best match first." />}>
                Twice a week, {BRAND.name} searches job boards and company career pages. It reads the whole posting. After each search it shows you what
                it looked at and what it skipped.
              </Step>
              <Step n={3} title="You decide" media={<Clip src="/landing/how-decide.mp4" poster="/landing/how-decide.jpg" label="Turning on the pay filter, archiving two low matches and pinning a strong one." />}>
                Each job gets a score from 1 to 5 with the reasons. Jobs that hit a dealbreaker never show up. Jobs below your pay floor still show up with
                a lower score, so you can decide.
              </Step>
            </div>
          </section>

          <section className={s.section}>
            <div className={`${s.split} ${s.splitFlip}`}>
              <Playable className={s.shot}>
                <Clip src="/landing/how-learns.mp4" poster="/landing/how-learns.jpg" label="A find opens, the reasons get read, the stage moves to Applied and a note goes in." />
              </Playable>
              <div>
                <div className={s.eyebrow}>It learns</div>
                <h2 className={s.h2}>Tell it why a job is wrong, and it adjusts.</h2>
                <ul className={s.list}>
                  <li>When you mark a job &ldquo;not a fit&rdquo; and say why, the next search uses that.</li>
                  <li>Notes you leave on a job change how it scores.</li>
                  <li>You can see what {BRAND.name} thinks you want, and edit it.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className={s.section}>
            <div className={s.split}>
              <div>
                <div className={s.eyebrow}>Applying <span className={s.beta}>Beta</span></div>
                <h2 className={s.h2}>{BRAND.name} drafts your application, and you send it.</h2>
                <ul className={s.list}>
                  <li>For the jobs you pick, {BRAND.name} writes a resume and cover letter from your own resume and the posting.</li>
                  <li>A built-in recruiter review points out gaps before you send it.</li>
                  <li>You review every line and press Submit yourself.</li>
                </ul>
              </div>
              <Playable className={s.shot}>
                <Clip src="/landing/how-applying.mp4" poster="/landing/how-applying.jpg" label="A drafted resume, its Recruiter Analysis at 86 out of 100, and the Approve button." />
              </Playable>
            </div>
          </section>

          <section className={s.dark}>
            <div className={s.eyebrow} style={{ color: "#F8A865" }}>Privacy</div>
            <h2 className={s.h2}>How {BRAND.name} treats your data.</h2>
            <div className={s.trust}>
              <div className={s.trustItem}><b>No passwords</b>Sign in with a one-time link to your email.</div>
              <div className={s.trustItem}><b>Not for sale</b>{BRAND.name} shows no ads, uses no tracking cookies, and never sells your data.</div>
              <div className={s.trustItem}><b>Leave any time</b>Export your board, or delete everything from Settings.</div>
              <div className={s.trustItem}><b>Open source</b>Read every line on <a href={BRAND.repo}>GitHub</a>.</div>
            </div>
          </section>

          <section className={s.section}>
            <div className={s.eyebrow}>Why I built it</div>
            <p className={s.lede}>
              I built {BRAND.name} for my own job search. I had an AI agent read job postings and score them against my resume, and it worked well
              enough that friends asked to use it. So I turned it into an app where everyone gets their own search. - Eric
            </p>
          </section>

          <section className={s.final}>
            <h2 className={s.h2} style={{ maxWidth: "14em" }}>{BRAND.name} is free while it&apos;s in testing.</h2>
            <Link href={join} className={s.finalBtn}>{cta}</Link>
          </section>
        </main>

        <SiteFooter pages={pages} />
      </div>
    </div>
  );
}

function Step({ n, title, media, children }: { n: number; title: string; media: React.ReactNode; children: React.ReactNode }) {
  return (
    <Playable className={s.step}>
      <span className={s.stepN}>{n}</span>
      <h3 className={s.stepT}>{title}</h3>
      <p className={s.stepP}>{children}</p>
      <div className={s.stepImg}>{media}</div>
    </Playable>
  );
}
