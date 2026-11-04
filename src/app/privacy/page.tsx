import Link from "next/link";

export const metadata = { title: "Privacy · Lookout" };

/** Plain-language privacy page. Keep it true: update it whenever what's stored or who sees it changes. */
export default function Privacy() {
  return (
    <main style={{ minHeight: "100vh", background: "#EFEEEC", padding: "32px 16px" }}>
      <article style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,26,15,.08)" }}>
        <div style={{ background: "#1D1A0F", color: "#fff", padding: "22px 26px" }}>
          <Link href="/" className="wordmark" style={{ color: "#fff", textDecoration: "none" }}>Lookout</Link>
        </div>
        <div style={{ padding: "28px 26px 34px", fontSize: 15, lineHeight: 1.6, color: "#3B362C" }}>
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#99220F" }}>Privacy</div>
          <h1 style={{ margin: "8px 0 4px", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: "#1D1A0F" }}>What Lookout keeps, and who sees it</h1>
          <p style={{ color: "#6B6358", fontSize: 14, margin: 0 }}>Last updated November 3, 2026</p>

          <H>The short version</H>
          <p>Lookout is a small, invite-only tool run by Eric Devlin. It keeps what you give it so it can search for you. It doesn&apos;t sell your data, show ads or use tracking cookies. You can export your board and profile, or delete everything, from Settings.</p>

          <H>What it keeps</H>
          <ul>
            <li>Your email, name, and the devices you&apos;re signed in on.</li>
            <li>Your answers to the five profile questions.</li>
            <li>Your resume and LinkedIn PDF, if you upload them: the files and the text pulled from them.</li>
            <li>Links you add, and the text Lookout reads from those pages.</li>
            <li>Your search profile: the summary Lookout builds from all of the above. You can see it under Profile, What Lookout sees.</li>
            <li>Your board: the roles found for you, plus your stages, notes, pins and &ldquo;Not a fit&rdquo; reasons.</li>
            <li>Your application drafts and approved versions, including public people Lookout suggests you contact and your outreach message drafts. Lookout never sends those messages.</li>
            <li>A log of each search: when it ran, what it searched for, and what it cost.</li>
            <li>What you do in Lookout: the pages you open and for how long, and actions like searching, pinning, moving a find or opening a posting. Lookout records this itself to see what&apos;s useful; no outside analytics or ad scripts are on the site.</li>
            <li>Which links you click in the finds email. Links in that email pass through Lookout first, so it can tell whether the finds are useful. It doesn&apos;t track whether you open the email.</li>
          </ul>

          <H>Who sees it</H>
          <p>You. Eric, as the admin, sees the list of accounts with emails, sign-in dates, counts of finds and search costs. During the beta, he can also open a read-only view of your board to test Lookout and fix problems you run into. He can&apos;t change anything there, and each view is logged. He can also reach the database itself, so treat what you upload as something he could read. No one else gets access.</p>

          <H>Services it uses</H>
          <ul>
            <li><b>An AI model.</b> To build your search profile and score postings, Lookout sends your profile answers and the text of your resume, LinkedIn PDF and links to an AI model through OpenRouter. Lookout tells OpenRouter to use only hosts that don&apos;t keep your data or train on it, and to try US hosts first. Lookout doesn&apos;t train any models on your data either.</li>
            <li><b>Web search.</b> Lookout runs its own search engine relay. The queries it sends are job titles, company names, places and keywords, never your name, email or resume.</li>
            <li><b>Email.</b> Sign-in links and invites go out through Resend.</li>
            <li><b>Hosting and backups.</b> The app and its database run on a private server. A backup is taken every night, encrypted, and kept for up to 60 days in Amazon S3.</li>
          </ul>

          <H>Cookies</H>
          <p>One cookie keeps you signed in. It lasts 90 days and renews while you use Lookout. There are no analytics or advertising cookies.</p>

          <H>Your controls</H>
          <ul>
            <li><b>Export:</b> Settings, Export data downloads your board, stages, notes and profile answers.</li>
            <li><b>Delete:</b> Settings, Delete everything removes your account and all of the above right away. Copies in encrypted backups age out within 60 days.</li>
            <li><b>Remove one thing:</b> delete your resume, LinkedIn PDF or any link on the Materials tab, and it stops being used.</li>
          </ul>

          <H>Questions</H>
          <p>Email <a href="mailto:ericdevlin@me.com" style={{ color: "#99220F" }}>ericdevlin@me.com</a>.</p>
        </div>
      </article>
    </main>
  );
}

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 style={{ margin: "26px 0 6px", fontSize: 18, fontWeight: 700, color: "#1D1A0F" }}>{children}</h2>
);
