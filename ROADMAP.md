# Lookout roadmap

Lookout is a personal search agent. You tell it what you want, it searches the web on a schedule, scores what it finds against your profile, and puts the matches on a board you triage. Jobs are the first opportunity type. The goal is one engine for any kind of find. Its edge is context: the more it knows about you, the better it judges fit, and it takes the grind out of looking.

Work items live as GitHub issues, labeled by area (`feature`, `security`, `hardening`, `accessibility`, `code-quality`, `marketing`) and by milestone.

## Done: proof of concept (jobs)

- [x] Board, drawer, profile, materials, settings, mobile, from the design handoff
- [x] Magic-link sign-in, rolling 90-day sessions, change email, signed-in devices
- [x] Invite only, with request-access + admin approval, invite resend
- [x] Admin: people, caps, runs, AI settings with presets, encrypted keys, autosave
- [x] Open-model discovery pipeline (OpenRouter/DeepSeek), self-hosted SearXNG, SSRF-safe page reader
- [x] Live search progress, after-search report with linked tips
- [x] Resume scan, LinkedIn PDF, links read and used
- [x] Saved search profile, visible as "What Lookout sees"
- [x] "Not a fit" reasons fed back into searches
- [x] Email via Resend (SPF, DKIM, DMARC on ericdevlin.co)
- [x] Nightly backups, encrypted off-server copy, tested restore
- [x] Privacy page

## Next: beta

- [ ] Paul and Jeff onboarded; review their first two weeks of finds with them
- [ ] One-question beta surveys: a note from Eric, shown once on sign-in every few days, answers in Admin
- [ ] Reviews: code quality, security (OWASP-style), accessibility (WCAG 2.2 AA); findings filed as issues
- [ ] Ticket agent: a schedule that checks whether an agent is working the issue queue, and if not, finds where work stopped and picks up the next issue (works on branches, opens PRs, never deploys on its own)
- [ ] Auto-apply (beta, off by default, per-user switch): port the Notion pipeline flow (prep packet, review, green light, submit) into Lookout
- [ ] Networking: the sweep also finds events, meetups and talks near the user that match their field and interests, on a separate "Events" list

## Then: more kinds of finds

The RFP request is the test of whether the engine is really type-agnostic.

- [ ] Kind picker at sign-up; one account can hold several searches ("searches" table, a board per search)
- [ ] `rfp` kind: capabilities, NAICS codes, certifications (8(a), WOSB, SDVOSB), contract size, geographies; stages Reviewing / Bid / Submitted / Awarded / Lost; columns agency, due date, value, set-aside; SAM.gov API first, then state and city portals
- [ ] UI copy, columns and stages driven by the kind config
- [ ] Deadline-aware sorting and a "due soon" digest section
- [ ] More kinds (candidates below)

Candidate kinds, roughly by fit with the engine (rich personal context + a recurring sweep + triage):

- Work: jobs, freelance and contract gigs, board seats and advisory roles, speaking slots and conference CFPs, podcast guest spots
- Money: RFPs and government contracts, grants and fellowships, residencies and artist calls, scholarships, accelerator programs
- Life: rentals and homes, schools and programs, doctors and specialists accepting patients, caregivers
- Buying: cars, specific products or restocks, deals under a price, collectibles and resale
- People: networking events, mentors, cofounders, investors who fund your space, partners for a project

## Then: productize

- [ ] Marketing pages and an email waitlist
- [ ] Blog post on ericdevlin.co about building it
- [ ] Brand, domain and pricing; billing (Stripe) metered on the runs table
- [ ] Terms of service
- [ ] Tailored resume per role

## Harden and secure

Must be done before opening sign-up beyond friends. Each item is an issue labeled `hardening` or `security`.

- [x] Nightly encrypted backups off the VPS with a tested restore
- [x] SPF, DKIM and DMARC on the sending domain
- [x] Signed-in devices and "sign out everywhere"
- [ ] Persist VPS firewall rules; confirm Postgres is unreachable from outside
- [ ] Uptime check and alerting on `/api/health`; error tracking
- [ ] Bot protection on request access (Cloudflare Turnstile)
- [ ] CSP with nonces instead of `'unsafe-inline'`
- [ ] Rate limits in Postgres so they survive restarts
- [ ] Prompt-injection review of fetched pages and link text
- [ ] Encrypt uploaded files at rest; retention policy for runs and logs
- [ ] CI on every push: typecheck, lint, tests, `npm audit`; Dependabot
- [ ] Deploys from CI instead of a laptop; staging
- [ ] Third-party security review before any paid launch
