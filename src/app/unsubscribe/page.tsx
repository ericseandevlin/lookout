import { readToken } from "@/lib/bulkMail";
import { Unsubscribe } from "@/components/Unsubscribe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe · Lookout" };

/** Where the unsubscribe link in an email lands (#28). One button, no sign-in. */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const parsed = readToken(t);
  return (
    <main>
      <Unsubscribe token={t} email={parsed?.email ?? null} list={parsed?.list ?? null} />
    </main>
  );
}
