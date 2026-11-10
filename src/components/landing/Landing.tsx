import Image from "next/image";
import { LegalLinks } from "@/components/LegalLinks";
import s from "./landing.module.css";

/**
 * The one-page site at / (#600). Server-rendered; `card` is the sign-in / request-access card
 * (or the group join card on /join/<code>), shown in the hero and reachable from every "Get in" link.
 * Screenshots are from the media kit's demo account ("Maya Ortiz", made-up companies): no real user data.
 */
export function Landing({ card }: { card: React.ReactNode }) {
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <header className={s.nav}>
          <a href="/" className="wordmark" style={{ fontSize: 24, color: "#1D1A0F", textDecoration: "none" }}>Lookout</a>
          <nav className={s.navLinks} aria-label="Site">
            <a href="#how" className={s.hideSm}>How it works</a>
            <a href="/signin">Sign in</a>
            <a href="#get-in" className={s.navCta}>Get in</a>
          </nav>
        </header>

        <main>
          <section className={s.hero}>
            <div>
              <div className={s.eyebrow}>In testing · invite only</div>
              <h1 className={s.h1}>Stop refreshing job boards.</h1>
              <p className={s.lede}>
                Answer five questions. Twice a week Lookout goes looking, reads every posting, and puts the ones that fit on your board, each with a
                score and a plain reason why.
              </p>
              <div className={s.facts}>
                <span className={s.fact}>Reads the whole posting</span>
                <span className={s.fact}>Dealbreakers never show up</span>
                <span className={s.fact}>No passwords</span>
                <span className={s.fact}>Free while in testing</span>
              </div>
            </div>
            <div className={s.heroCard}>{card}</div>
          </section>

          <div className={`${s.shot} ${s.board}`}>
            <Image src="/landing/03-board.jpg" alt="A Lookout board: eight roles, each with a match score from 1 to 5, the company, pay range, when it was posted, its stage and location." width={1600} height={1000} priority sizes="(max-width: 1160px) 100vw, 1112px" />
          </div>

          <section className={s.section} id="how" style={{ scrollMarginTop: 24 }}>
            <div className={s.eyebrow}>How it works</div>
            <h2 className={s.h2}>You answer five questions. It does the looking.</h2>
            <div className={s.steps}>
              <Step n={1} title="Five questions" img="/landing/06-five-questions.jpg" alt="The five onboarding questions.">
                What&apos;s next, the pay you&apos;d walk away from, where you&apos;ll work, the win you lead with, and what&apos;s off the table. Add a resume
                if you want. That&apos;s the setup.
              </Step>
              <Step n={2} title="It goes looking" img="/landing/02-search-report.jpg" alt="The report after a search: how many postings were found, read and kept.">
                Job boards and company career pages, twice a week. It reads the full posting, not the title, and tells you what it looked at and what it
                threw out.
              </Step>
              <Step n={3} title="You decide" img="/landing/04-why-it-matched.jpg" alt="One find open, with the reasons it matched.">
                Every find gets a score from 1 to 5 and the reasons. A dealbreaker never makes the board. A role under your floor still shows up, marked
                down. Your call.
              </Step>
            </div>
          </section>

          <section className={s.section}>
            <div className={`${s.split} ${s.splitFlip}`}>
              <div className={s.shot}>
                <Image src="/landing/07-what-lookout-sees.jpg" alt="The search profile Lookout builds from your answers." width={1600} height={1000} sizes="(max-width: 960px) 100vw, 600px" />
              </div>
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
              <div className={s.shot}>
                <Image src="/landing/05-stage-menu.jpg" alt="Moving a find through stages, from not applied to offer." width={1600} height={1000} sizes="(max-width: 960px) 100vw, 600px" />
              </div>
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
            <h2 className={s.h2} style={{ maxWidth: "12em" }}>Let it do the refreshing.</h2>
            <p className={s.sub}>Free while Lookout is in testing.</p>
            <a href="#get-in" className={s.finalBtn}>Get in</a>
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

function Step({ n, title, img, alt, children }: { n: number; title: string; img: string; alt: string; children: React.ReactNode }) {
  return (
    <div className={s.step}>
      <span className={s.stepN}>{n}</span>
      <h3 className={s.stepT}>{title}</h3>
      <p className={s.stepP}>{children}</p>
      <div className={s.stepImg}>
        <Image src={img} alt={alt} width={1600} height={1000} sizes="(max-width: 960px) 100vw, 360px" />
      </div>
    </div>
  );
}
