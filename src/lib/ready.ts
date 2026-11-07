/**
 * What still stands between someone and a search (#255): all five answers, then a resume Lookout has read.
 * Null when they can search. The scheduler applies the same rule to scheduled runs.
 */
export function searchBlocker(answered: number, resume: string | null | undefined): { text: string; href: string } | null {
  if (answered < 5) return { text: "Answer the 5 profile questions to search", href: "/profile" };
  if (resume === "scanning") return { text: "Lookout is still reading your resume", href: "/profile/materials" };
  if (resume !== "done") return { text: "Add your resume to search", href: "/profile/materials" };
  return null;
}
