import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { FinalCta, joinHref, SiteFooter, SiteHeader } from "./Site";
import s from "./landing.module.css";

type Status = "live" | "testing" | "next";
const TAG: Record<Status, [string, string]> = { live: ["Live", s.tagLive], testing: ["In testing", s.tagTest], next: ["On the list", s.tagNext] };

/** What it can look for, and where each one stands. Keep in step with ROADMAP > "Which kinds first". */
const KINDS: { title: string; status: Status; body: string }[] = [
  { title: "Jobs", status: "live", body: "Roles that fit where you're headed, scored 1 to 5 against your pay floor, location and dealbreakers." },
  { title: "Contract opportunities", status: "testing", body: "Federal RFPs and solicitations, scored against what your business does and the set-asides you qualify for." },
  { title: "Networking events", status: "testing", body: "Meetups, panels, conferences and talks on your interests, nearby or online, with a fit score and rough distance." },
  { title: "Grants and fellowships", status: "next", body: "Rewards the same context jobs do, and has deadlines worth a reminder." },
  { title: "Speaking slots", status: "next", body: "Conference calls for papers and podcast guest spots that match what you talk about." },
  { title: "Rentals", status: "next", body: "Homes that fit the list you'd otherwise check by hand every morning." },
];

/**
 * /what-it-finds (#9): the same engine pointed at other searches. Honest about status: only jobs are open today.
 * The waitlist form asks what they'd search for, which is how we pick what's next.
 */
export function KindsPage({ inviteOnly, channel }: { inviteOnly: boolean; channel: string | null }) {
  const n = BRAND.name;
  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <SiteHeader inviteOnly={inviteOnly} channel={channel} pages />
        <main>
          <section className={s.section} style={{ paddingTop: 28 }}>
            <div className={s.eyebrow}>What it finds</div>
            <h1 className={s.h1} style={{ maxWidth: "11em" }}>Jobs first. Then anything you&apos;d search for twice.</h1>
            <p className={s.lede}>
              The hard part of a search isn&apos;t finding listings. It&apos;s reading them all to find the three that fit you. {n} does that reading, and
              jobs were just the first thing we pointed it at.
            </p>
          </section>

          <section className={s.section} style={{ paddingTop: 48 }}>
            <div className={s.cards}>
              {KINDS.map((k) => (
                <div key={k.title} className={s.card}>
                  <span className={`${s.tag} ${TAG[k.status][1]}`}>{TAG[k.status][0]}</span>
                  <h3>{k.title}</h3>
                  <p>{k.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={s.section}>
            <div className={s.split}>
              <div>
                <div className={s.eyebrow}>What makes a good fit</div>
                <h2 className={s.h2}>Searches where you matter.</h2>
                <ul className={s.list}>
                  <li>What counts as a match depends on you, not just a keyword.</li>
                  <li>New options keep showing up, so checking once isn&apos;t enough.</li>
                  <li>Reading every listing is the part people hate.</li>
                </ul>
              </div>
              <div className={s.card}>
                <h3>Tell us what you&apos;d search for</h3>
                <p>The waitlist asks one question: what would you want it to look for? Those answers decide what we build next.</p>
                <Link href={joinHref(channel)} className={s.btn} style={{ alignSelf: "flex-start", marginTop: 8 }}>{inviteOnly ? "Join the waitlist" : "Get started"}</Link>
              </div>
            </div>
          </section>

          <FinalCta inviteOnly={inviteOnly} channel={channel} />
        </main>
        <SiteFooter pages />
      </div>
    </div>
  );
}
