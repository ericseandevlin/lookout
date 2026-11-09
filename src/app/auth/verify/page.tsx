import { Verify } from "@/components/Verify";
import { consentDueFor } from "@/lib/auth/loginToken";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" as const };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = typeof token === "string" ? token : "";
  return (
    <main>
      <Verify token={t} consent={t ? await consentDueFor(t) : null} />
    </main>
  );
}
