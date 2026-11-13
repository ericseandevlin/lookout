# Subprocessors

Every outside service that touches Lookout user data (#25). The public version is the "Services that handle your data" list on `/privacy` (`src/app/privacy/page.tsx`). Keep both in step: add a service here and on the page before the code starts using it, and bump `PRIVACY_VERSION` in `src/lib/legal.ts` when the page changes.

| Service | What it gets | Why | Where in code | DPA |
| --- | --- | --- | --- | --- |
| Hostinger | Everything: app, database, uploaded files, 14 days of nightly dumps | Rents the VPS that runs Lookout | `deploy/` | Not yet accepted |
| OpenRouter, plus the model host it routes to | Profile answers, resume, LinkedIn and link text, search profile, postings, application drafts | Build the search profile, score finds, draft applications | `src/lib/ai/` | Not yet accepted |
| PostHog, through OpenRouter Broadcast | One record per AI request: step name, kind of work, run id, a hashed person id, model, tokens, cost, timing. No prompt or reply text (Privacy Mode is on for the production key) | Trace AI requests to find failing or costly steps (#985) | `src/lib/ai/trace.ts`; switched on in OpenRouter Settings > Observability | Not yet accepted |
| Resend | Email addresses; sign-in links, invites, finds email; inbound mail to lookout.ericdevlin.co; delivery events | Outbound and inbound email | `src/lib/email.ts`, `src/lib/inbound/` | Not yet accepted |
| Amazon S3 | Nightly database dump and files archive, AES-256 encrypted on Eric's Mac before upload, kept 60 days | Off-site backups | `deploy/backup.sh`, Life-OS `scripts/lookout/pull-backup.sh` | Not yet accepted |
| Cloudflare Turnstile | IP address and browser signals, on the request-access form only | Bot check | `src/lib/turnstile.ts` | Not yet accepted |
| Search engines, via the SearXNG relay | Queries only: titles, companies, places, keywords. No name, email or resume | Find postings and events | `deploy/searxng/`, `src/lib/ai/search.ts` | None (no personal data sent) |
| SAM.gov | Keywords, RFP searches only | Public contract search | `src/lib/samGov.ts` | None (public government API, no personal data sent) |

Not subprocessors, listed for completeness:

- **Public sites Lookout reads** (job postings, ATS boards, links a user adds): see a request from the server, nothing about the user.
- **Employer application sites** (Greenhouse, Lever, Ashby and others, through auto-apply): receive an application only after the user approves the exact version. The user is the sender; the employer is a recipient, not a processor for Lookout.
- **Eric's Mac**: pulls the nightly dumps and keeps 30 days before encrypting them for S3. Covered by "Who sees it" on the privacy page.

## DPAs

For each row marked "Not yet accepted": accept the provider's data processing terms in the account (or confirm they are part of the terms already agreed to), save a dated PDF copy, and change the cell to "Accepted YYYY-MM-DD" with where the copy lives. The provider accounts are Eric's, so this step is his.
