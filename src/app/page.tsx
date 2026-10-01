import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Login } from "@/components/Login";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getSessionUser()) redirect("/finds");
  return <Login />;
}
