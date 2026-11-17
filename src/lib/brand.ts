/**
 * The product's name, in one place (#9). The brand decision is parked, so the marketing pages,
 * the waitlist and the emails read the name from here: a rename is a change to this file.
 * Older in-app copy still says "Lookout" directly; move it here as it's touched.
 */
export const BRAND = {
  name: "Lookout",
  tagline: "a search agent that reads the postings for you",
  maker: { name: "Eric Devlin", url: "https://ericdevlin.co" },
  repo: "https://github.com/ericseandevlin/lookout",
} as const;

/** "Page · Lookout", the title format every public page uses. */
export const pageTitle = (page: string) => `${page} · ${BRAND.name}`;
