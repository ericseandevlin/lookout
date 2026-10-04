import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/users";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user || !isAdmin(user)) notFound();
  return children;
}
