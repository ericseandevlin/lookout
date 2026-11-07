import { PRIVACY_VERSION } from "@/lib/legal";
import { H, LEGAL_CONTACT as CONTACT, LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Privacy · Lookout" };
export const dynamic = "force-dynamic";

/** Plain-language privacy page. Keep it true: update it whenever what's stored or who sees it changes, and bump PRIVACY_VERSION in lib/legal.ts. */
export default function Privacy() {
  return (
    <LegalPage eyebrow="Privacy" title="What Lookout keeps, and who sees it" version={PRIVACY_VERSION}>
      <H>The short version</H>
      <p>Lookout is a small, invite-only tool run by Eric Devlin. It keeps what you give it so it can search for you. It doesn&apos;t sell your data, show ads or use tracking cookies. You can export your board and profile, or delete everything, from Settings.</p>

      <H>What it keeps</H>
      <ul>
        <li>Your email, name, and the devices you&apos;re signed in on.</li>
        <li>If you asked for an invite: your email, your answers on that form, and which version of its email notice you saw and when.</li>
        <li>If you unsubscribe: your email on a do-not-email list. It stays even after you delete your account, so Lookout never emails you news again.</li>
        <li>Which versions of the Terms and this page you agreed to, and when.</li>
        <li>Your answers to the five profile questions.</li>
        <li>Your resume and LinkedIn PDF, if you upload them: the files and the text pulled from them. Uploaded files are stored encrypted.</li>
        <li>Links you add, and the text Lookout reads from those pages.</li>
        <li>Your search profile: the summary Lookout builds from all of the above. You can see it under Profile, What Lookout sees.</li>
        <li>Your searches: what each one looks for (jobs, or RFPs for a business), and its board: the finds, plus your stages, notes, pins and &ldquo;Not a fit&rdquo; reasons.</li>
        <li>If you turn on events: your event interests, and the public events Lookout found for you. Past events are deleted.</li>
        <li>Your application drafts and approved versions, including public people Lookout suggests you contact and your outreach message drafts. Lookout never sends those messages.</li>
        <li>A log of each search: when it ran, what it searched for, and what it cost. After 12 months the details are deleted; only the counts and cost stay.</li>
        <li>Your answers to the short beta surveys, if you answer them.</li>
        <li>What you do in Lookout: the pages you open and for how long, and actions like finishing the welcome step, searching, pinning, moving a find, opening a posting or turning auto-apply on or off. Lookout records this itself to see what&apos;s useful; no outside analytics or ad scripts are on the site.</li>
        <li>Which links you click in the finds email. Links in that email pass through Lookout first, so it can tell whether the finds are useful. It doesn&apos;t track whether you open the email.</li>
      </ul>

      <H>Who sees it</H>
      <p>You. Eric, as the admin, sees the list of accounts with emails, sign-in dates, counts of finds, search costs, how far each person got through setup, and what each person did in Lookout. During the beta, he can also open a read-only view of your board to test Lookout and fix problems you run into. He can&apos;t change anything there, and each view is logged. He can also reach the database itself, so treat what you upload as something he could read. No one else gets access.</p>

      <H>Services that handle your data</H>
      <p>This is every outside service that touches your data, and what each one gets. Lookout adds to this list before it starts using a new one.</p>
      <ul>
        <li><b>Hostinger (server host).</b> Gets: everything above. The app and its database run on a private server rented from Hostinger. Hostinger runs the machine; it doesn&apos;t use what&apos;s on it.</li>
        <li><b>OpenRouter, and the AI model host it picks.</b> Gets: your profile answers, the text of your resume, LinkedIn PDF and links, your search profile, and the postings being scored or drafted for. Why: to build your search profile, score finds and draft applications. Lookout tells OpenRouter to use only hosts that don&apos;t keep your data or train on it, and to try US hosts first. Lookout doesn&apos;t train any models on your data either.</li>
        <li><b>Resend (email).</b> Gets: your email address and the emails Lookout sends you: sign-in links, invites and the finds email. It also receives mail sent to Lookout&apos;s own addresses, like the one at the bottom of this page, and tells Lookout whether each email was delivered.</li>
        <li><b>Amazon S3 (backups).</b> Gets: a nightly copy of the database and uploaded files, encrypted before upload, so Amazon can&apos;t read it. Copies are kept for up to 60 days. Before upload, the server keeps 14 days of copies and Eric&apos;s own computer keeps 30.</li>
        <li><b>Cloudflare Turnstile (bot check).</b> Gets: your IP address and the browser details its check reads, only when you fill in the request-access form. Why: to keep bots off that form.</li>
        <li><b>Search engines, through Lookout&apos;s own relay.</b> Get: search queries only: job titles, company names, places and keywords. Never your name, email or resume. Queries come from Lookout&apos;s server, not your browser.</li>
        <li><b>SAM.gov.</b> Gets: the same kind of keywords, for RFP searches only. It&apos;s the US government&apos;s public contracts site.</li>
      </ul>
      <p>Lookout also reads public pages, such as job postings and the links you add. Those sites see a visit from Lookout&apos;s server, nothing about you. If you use auto-apply, an application goes to that employer&apos;s site only after you approve the exact version that goes out.</p>

      <H>Cookies</H>
      <p>One cookie keeps you signed in. It lasts 90 days and renews while you use Lookout. There are no analytics or advertising cookies.</p>

      <H>Your controls</H>
      <ul>
        <li><b>Export:</b> Settings, Export data downloads your board, stages, notes, profile answers and what Lookout recorded you doing.</li>
        <li><b>Delete:</b> Settings, Delete everything removes your account and all of the above right away. Copies in encrypted backups age out within 60 days.</li>
        <li><b>Unsubscribe:</b> every email except sign-in links and invites has an unsubscribe link at the bottom. It works at once and needs no sign-in.</li>
        <li><b>Remove one thing:</b> delete your resume, LinkedIn PDF or any link on the Materials tab, and it stops being used.</li>
      </ul>

      <H>Questions</H>
      <p>Email <a href={`mailto:${CONTACT}`} style={{ color: "#99220F" }}>{CONTACT}</a>.</p>
    </LegalPage>
  );
}
