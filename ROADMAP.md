# Lookout roadmap

Lookout is a personal search agent. You tell it what you want, it searches the web on a schedule, scores what it finds against your profile, and puts the matches on a board you triage. Jobs are the first opportunity type. The goal is one engine for any kind of find: jobs, RFPs, grants, homes, rentals, cars, products, deals.

## Now: proof of concept (jobs, Paul)

Live at `paulfinds.pauljustinscott.com`.

- [x] Finds board, role drawer, Search profile, Materials, Settings, mobile, all from the design handoff
- [x] Email magic-link sign-in, open sign-up (anyone can create an account and start a search)
- [x] Resume scan (PDF/DOCX) that fills empty profile answers
- [x] Discovery agent: Claude with web search + web fetch, structured scoring, hard rules (comp floor, location, dealbreakers)
- [x] Manual add by link, Search now, weekly/twice/daily schedule, email digest
- [x] Daily spend caps (global and per user), rate limits, run log with token cost
- [x] Paul's existing board imported from the old pauljobs site
- [ ] SMTP provider connected so sign-in and digest emails go out
- [ ] Paul onboarded: profile answered, resume uploaded, first run reviewed with him
- [ ] Tune the scoring prompt against Paul's first two weeks of triage (what he pins vs. archives)

## Next: second opportunity type (RFPs)

A friend wants Lookout to find RFPs. This is the test of whether the engine is really type-agnostic.

- [ ] `rfp` kind config in `src/lib/kinds`: profile questions (capabilities, NAICS codes, certifications such as 8(a)/WOSB/SDVOSB, contract size range, geographies, agencies to avoid), stages (Reviewing, Bid, Submitted, Awarded, Lost), columns (agency, due date, value, set-aside)
- [ ] Sources: SAM.gov opportunities API first (structured, free with an API key), then state and city procurement portals through web search
- [ ] Drive UI copy, columns and stages from the kind config instead of job-specific strings
- [ ] Deadline-aware sorting and a "due soon" digest section
- [ ] Choose kind at sign-up; one account can hold more than one search ("searches" table, board per search)

## Then: productize

- [ ] Multi-search accounts and a search switcher
- [ ] Public landing page and onboarding that picks the find type first
- [ ] Brand, domain and pricing decision; billing (Stripe) with usage metering tied to the runs table
- [ ] Admin view: users, runs, spend, failures, disable/enable accounts
- [ ] Terms of service and privacy policy (we store resumes)
- [ ] Feedback loop: learn from pins, archives and stages to rescore future finds
- [ ] Tailored resume per role (designed in the handoff as a later phase)
- [ ] More kinds: grants and fellowships, speaking CFPs, freelance leads, rentals and homes, cars, products and deals

## Harden and secure

Must be done before opening sign-up beyond friends.

- [ ] Nightly encrypted Postgres backups off the VPS, with a tested restore
- [ ] Persist the firewall rules on the VPS (they reset on reboot today) and confirm Postgres is unreachable from outside
- [ ] Uptime check and alerting on `/api/health`; error tracking
- [ ] Bot protection on sign-up (Cloudflare Turnstile) and per-domain sign-up throttles
- [ ] Email deliverability: SPF, DKIM and DMARC on the sending domain
- [ ] CSP with nonces instead of `'unsafe-inline'`
- [ ] Move rate limits from process memory to Postgres so they survive restarts
- [ ] Prompt-injection review: fetched pages are untrusted; keep model output out of anything executable and keep scoring output schema-bound
- [ ] Encrypt uploaded resumes at rest; retention policy for runs and logs
- [ ] CI on every push: typecheck, lint, tests, `npm audit`; Dependabot
- [ ] Staging environment and a deploy that doesn't need a laptop (GitHub Actions to a registry)
- [ ] Session list and "sign out everywhere" in Settings
- [ ] Third-party security review before any paid launch
