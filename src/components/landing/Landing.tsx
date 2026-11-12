import Image from "next/image";
import Link from "next/link";
import { LegalLinks } from "@/components/LegalLinks";
import { Clip, FiveQuestions, Playable, ProductVideo } from "./Motion";
import s from "./landing.module.css";

/**
 * The one-page site at / (#600). Sign-in and request access live on their own pages (/signin, /request-access).
 * Every screen and clip is the real app on a demo account ("Maya Ortiz", made-up companies): no real user data.
 */
export function Landing({ inviteOnly, channel }: { inviteOnly: boolean; channel: string | null }) {
  const cta = inviteOnly ? "Request access" : "Get started";
  const join = channel ? `/request-access?ref=${encodeURIComponent(channel)}` : "/request-access";
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <header className={s.nav}>
          <Link href="/" className="wordmark" style={{ fontSize: 24, color: "#1D1A0F", textDecoration: "none" }}>Lookout</Link>
          <nav className={s.navLinks} aria-label="Site">
            <a href="#how" className={s.hideSm}>How it works</a>
            <Link href="/signin">Sign in</Link>
            <Link href={join} className={s.navCta}>{cta}</Link>
          </nav>
        </header>

        <main>
          <section className={s.hero}>
            <div className={s.heroText}>
              <div className={s.eyebrow}>In testing · {inviteOnly ? "invite only" : "free"}</div>
              <h1 className={s.h1}>Stop refreshing job boards.</h1>
              <p className={s.lede}>
                Answer five questions. Twice a week Lookout goes looking, reads every posting, and puts the ones that fit on your board, each with a
                score and a plain reason why.
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
            <h2 className={s.h2}>You answer five questions. It does the looking.</h2>
            <div className={s.steps}>
              <Step n={1} title="Five questions" media={<FiveQuestions />}>
                What&apos;s next, the pay you&apos;d walk away from, where you&apos;ll work, the win you lead with, and what&apos;s off the table. Add a resume
                if you want. That&apos;s the setup.
              </Step>
              <Step n={2} title="It goes looking" media={<Clip src="/landing/how-looking.mp4" poster="/landing/how-looking.jpg" label="The board filling with new finds, best match first." />}>
                Job boards and company career pages, twice a week. It reads the full posting, not the title, and tells you what it looked at and what it
                threw out.
              </Step>
              <Step n={3} title="You decide" media={<Clip src="/landing/how-decide.mp4" poster="/landing/how-decide.jpg" label="Turning on the pay filter, archiving two low matches and pinning a strong one." />}>
                Every find gets a score from 1 to 5 and the reasons. A dealbreaker never makes the board. A role under your floor still shows up, marked
                down. Your call.
              </Step>
            </div>
          </section>

          <section className={s.section}>
            <div className={`${s.split} ${s.splitFlip}`}>
              <Playable className={s.shot}>
                <Clip src="/landing/how-learns.mp4" poster="/landing/how-learns.jpg" label="A find opens, the reasons get read, the stage moves to Applied and a note goes in." />
              </Playable>
              <div>
                <div className={s.eyebrow}>It learns from your no</div>
                <h2 className={s.h2}>Tell it why, once.</h2>
                <ul className={s.list}>
                  <li>Mark a find &ldquo;not a fit&rdquo; and say why. The next search knows.</li>
                  <li>Notes you leave on a find become corrections to how it scores.</li>
                  <li>See exactly what Lookout thinks you want, and edit it.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className={s.section}>
            <div className={s.split}>
              <div>
                <div className={s.eyebrow}>Applying <span className={s.beta}>Beta</span></div>
                <h2 className={s.h2}>Drafted for you. Sent by you.</h2>
                <ul className={s.list}>
                  <li>For the roles you want, Lookout drafts the application from your resume and the posting.</li>
                  <li>A recruiter&apos;s read flags the gaps before a recruiter does.</li>
                  <li>You review every line and press Submit. Nothing goes out on its own.</li>
                </ul>
              </div>
              <Playable className={s.shot}>
                <Clip src="/landing/how-applying.mp4" poster="/landing/how-applying.jpg" label="A drafted resume, its Recruiter Analysis at 86 out of 100, and the Approve button." />
              </Playable>
            </div>
          </section>

          <section className={s.dark}>
            <div className={s.eyebrow} style={{ color: "#F8A865" }}>The fine print, up front</div>
            <h2 className={s.h2}>Your search is yours.</h2>
            <div className={s.trust}>
              <div className={s.trustItem}><b>No passwords</b>Sign in with a one-time link to your email.</div>
              <div className={s.trustItem}><b>Not for sale</b>No ads, no tracking cookies, and your data is never sold.</div>
              <div className={s.trustItem}><b>Leave any time</b>Export your board, or delete everything from Settings.</div>
              <div className={s.trustItem}><b>Open source</b>Read every line on <a href="https://github.com/ericseandevlin/lookout">GitHub</a>.</div>
            </div>
          </section>

          <section className={s.final}>
            <h2 className={s.h2} style={{ maxWidth: "12em" }}>Let&apos;s find it.</h2>
            <p className={s.sub}>Free while Lookout is in testing.</p>
            <Link href={join} className={s.finalBtn}>{cta}</Link>
          </section>
        </main>

        <footer className={s.foot}>
          <span>Lookout is built by <a href="https://ericdevlin.co">Eric Devlin</a>.</span>
          <LegalLinks />
        </footer>
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
