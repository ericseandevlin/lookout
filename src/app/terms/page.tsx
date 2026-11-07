import { TERMS_VERSION } from "@/lib/legal";
import { H, LEGAL_CONTACT as CONTACT, LegalPage } from "@/components/LegalPage";

export const metadata = { title: "Terms · Lookout" };
export const dynamic = "force-dynamic";

/**
 * Terms of Service for the beta (#20). A draft until the lawyer review (#22). When the wording changes in a way people
 * should agree to again, bump TERMS_VERSION in lib/legal.ts; everyone is asked again on their next visit (#21).
 */
export default function Terms() {
  return (
    <LegalPage eyebrow="Terms" title="Terms of Service" version={TERMS_VERSION}>
      <H>The short version</H>
      <p>Lookout is a beta. It searches for roles and events that might fit you, but it can&apos;t promise you&apos;ll find a job or anything else. It&apos;s provided as it is. Your content stays yours. Use it for your own search, and don&apos;t misuse it.</p>

      <H>Who these terms are with</H>
      <p>Lookout is run by Eric Devlin (&ldquo;Lookout&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). These terms are an agreement between you and us. By ticking the box when you sign up, or by using Lookout, you agree to them and to the <a href="/privacy" style={{ color: "#99220F" }}>Privacy Policy</a>. If you don&apos;t agree, don&apos;t use Lookout.</p>

      <H>Who can use it</H>
      <p>You must be at least 18 and able to enter a contract. During the beta, Lookout is invite-only. Keep your sign-in links and devices to yourself; you&apos;re responsible for what happens under your account.</p>

      <H>It&apos;s a beta</H>
      <p>Lookout is unfinished. Features may change, break or go away, and searches may miss roles, show roles that are closed, or get details wrong. We may reset, limit or change parts of it while we work on it.</p>

      <H>No guaranteed results</H>
      <p>Lookout doesn&apos;t guarantee that you&apos;ll find a job, get an interview, hear back from anyone, or get any other result. Fit scores, summaries and suggestions are made by AI models. They can be wrong or incomplete. Don&apos;t rely on them alone: check each posting yourself, and make your own decisions about where to apply and what to accept.</p>

      <H>Using it fairly</H>
      <p>Use Lookout for your own search. Don&apos;t:</p>
      <ul>
        <li>scrape, crawl or copy Lookout, or reach it through bots or scripts other than the ones it provides;</li>
        <li>upload or add other people&apos;s personal data, such as someone else&apos;s resume, without their consent;</li>
        <li>upload anything unlawful, or anything you don&apos;t have the right to share;</li>
        <li>try to get into other accounts, test or get around its security, or overload it;</li>
        <li>resell it, or use it to build a competing service.</li>
      </ul>

      <H>Your content</H>
      <p>You own what you put into Lookout: your profile answers, resume, LinkedIn PDF, links, notes and the rest. You give us only the permission we need to run Lookout for you: to store it, process it, send it to the services listed in the Privacy Policy, and show it back to you. That permission ends when you delete the content or your account, except for copies in backups, which age out as the Privacy Policy describes. We don&apos;t sell your content or use it to train AI models.</p>

      <H>Auto-apply</H>
      <p>Auto-apply is off unless it&apos;s turned on for your account. If you use it:</p>
      <ul>
        <li>You are the applicant. Each application goes out in your name, and only after you approve it.</li>
        <li>You&apos;re responsible for making sure what&apos;s submitted is true and accurate. Review every application before you approve it.</li>
        <li>Lookout keeps a record of exactly what it submitted for you, and when.</li>
        <li>Some job sites don&apos;t allow automated applications. Where a site&apos;s terms forbid it, Lookout prepares the application and you submit it yourself. You&apos;re responsible for following the terms of the sites you apply through.</li>
        <li>An employer&apos;s decision on your application is between you and them.</li>
      </ul>

      <H>Other sites</H>
      <p>Lookout links to job postings, events and other sites run by other people. We don&apos;t control them and aren&apos;t responsible for their content, their terms or what they do with information you give them.</p>

      <H>Stopping the service or an account</H>
      <p>You can stop using Lookout at any time, and delete your account from Settings. We may suspend or close an account, or stop Lookout entirely, at any time, for example if these terms are broken or the beta ends. Where we can, we&apos;ll tell you first and give you a chance to export your data.</p>

      <H>No warranties</H>
      <p><b>Lookout is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, express or implied, including warranties of merchantability, fitness for a particular purpose, accuracy and non-infringement.</b> We don&apos;t promise that it will be uninterrupted, secure or free of errors, or that anything it finds or scores is correct.</p>

      <H>Limits on liability</H>
      <p><b>To the fullest extent the law allows, we aren&apos;t liable for any indirect, incidental, special, consequential or punitive damages, or for lost income, lost opportunities, lost data or lost profits, arising from your use of Lookout. Our total liability for any claim about Lookout is limited to the greater of $50 or what you paid us for Lookout in the 12 months before the claim.</b> Some places don&apos;t allow these limits, so they may not all apply to you.</p>

      <H>Changes to these terms</H>
      <p>We may change these terms. When we do, we&apos;ll update the date at the top, and the next time you visit, Lookout will ask you to read and agree to the new version before you carry on. If you don&apos;t agree, stop using Lookout and delete your account.</p>

      <H>Governing law</H>
      <p>These terms are governed by the laws of the State of New York, without regard to its conflict of laws rules. Any dispute about them or about Lookout will be handled in the state or federal courts located in New York, and you and we agree to those courts&apos; jurisdiction.</p>

      <H>Questions</H>
      <p>Email <a href={`mailto:${CONTACT}`} style={{ color: "#99220F" }}>{CONTACT}</a>.</p>
    </LegalPage>
  );
}
