import { Verify } from "@/components/Verify";

export const metadata = { referrer: "no-referrer" as const };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main>
      <Verify token={typeof token === "string" ? token : ""} />
    </main>
  );
}
