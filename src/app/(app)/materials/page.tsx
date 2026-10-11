import { redirect } from "next/navigation";

// Materials moved under Profile.
export default function Page() {
  redirect("/profile/materials");
}
