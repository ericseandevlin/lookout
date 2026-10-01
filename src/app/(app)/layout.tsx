import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getState } from "@/lib/state";
import { Shell } from "@/components/Shell";
import { StoreProvider } from "@/components/store";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  const state = await getState(user);
  return (
    <StoreProvider initial={state}>
      <Shell>{children}</Shell>
    </StoreProvider>
  );
}
