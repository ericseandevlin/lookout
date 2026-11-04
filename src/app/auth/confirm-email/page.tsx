import { ConfirmEmail } from "@/components/ConfirmEmail";

export const metadata = { referrer: "no-referrer" as const, title: "Confirm email · Lookout" };

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main>
      <ConfirmEmail token={typeof token === "string" ? token : ""} />
    </main>
  );
}
