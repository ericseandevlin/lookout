import { secrets } from "@/lib/bulkMail";
import { pageTitle } from "@/lib/brand";
import { readConfirmToken } from "@/lib/waitlist";
import { ConfirmWaitlist } from "@/components/ConfirmWaitlist";

export const dynamic = "force-dynamic";
export const metadata = { title: pageTitle("Confirm"), robots: { index: false, follow: false } };

/** Where the confirm link in the waitlist email lands (#9). One button, no sign-in. */
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  return (
    <main>
      <ConfirmWaitlist token={t} email={readConfirmToken(t, secrets())} />
    </main>
  );
}
