# Changelog

Every production release of Lookout, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Each version is also a git tag and a [GitHub Release](https://github.com/ericseandevlin/lookout/releases). Numbers in parentheses are GitHub issues.

## [Unreleased]

Work merged to `main` (staging) and waiting for the weekly release.

### Added
- Auto-apply beta: personal stories on the Application answers page. Cover letters open with one true, personal line from a story that fits the company. If none fits, the letter has no personal line and the note asks one question about that company. A letter that points to a story you never gave is sent back to you (#155).

### Changed
- A bad link or a page error now shows a Lookout page with a way back, instead of the bare Next.js default. Error pages show a reference people can quote, never the error itself (#396).

### Fixed
- The daily cleanup job no longer fails on prod: dates in its raw SQL go in as ISO strings (#373).
- Agent mode: finished searches save their finds again. Since several searches per account (#8), every job the external agent finished failed with "Search not found" and stayed running (#398).

## [0.5.0] - 2026-11-07

Events and several searches per account ship switched off. They stay on staging until Eric turns them on with `FEATURE_EVENTS=on` and `FEATURE_SEARCHES=on` in the server's `.env` (#343).

### Added
- Several searches per account: a `searches` table holds each search's kind, profile answers and built search profile, and every account's board and runs belong to one search. The sidebar (and the mobile top bar) gets a search switcher: pick which search the app shows, rename one, or start a new one from the kind picker (#8).
- Bot check on Request access: with Cloudflare Turnstile keys set, the form shows Turnstile's widget and the server verifies the token before saving the request. Off until `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set (#13).
- Clickwrap consent: the welcome step needs a ticked "I agree to the Privacy Policy" box, and the version agreed to and when are stored per account. Accounts from before this, and everyone after the privacy version changes, are asked on their next visit. Terms join the box once the Terms page ships (#20) (#21).
- Terms of Service page for the beta at `/terms`: as-is beta, no guaranteed results, 18+, fair use, you own your content, auto-apply rules, ending accounts, no warranties, liability limits, changes with notice, New York law. The clickwrap box now names Terms and Privacy, so every account is asked once to agree. Linked from the sign-in footer, Settings, and the foot of both legal pages. A draft until the lawyer review (#22) (#20).
- Uptime check: GitHub calls `/api/health` on prod and staging every 5 minutes and opens an `outage` issue (emailed) when a site stays down, closing it when it is back. Quiet hours (10pm to 7am New York) hold alerts until a morning report (#12).
- Admin > Errors: unexpected server errors (API 500s, crashed pages, scheduler failures) are stored by Lookout itself and searchable for 30 days. No third-party tracker (#12).
- Retention policy, enforced daily: expired sign-in links and sessions are deleted, search logs over 12 months keep only counts and cost, and accounts unused for 12 months get one email. Deletion of idle accounts stays by hand. The privacy page gains a "How long it keeps it" section (#26).
- Run it yourself: `compose.yaml` at the repo root starts Postgres, SearXNG and Lookout on localhost; `scripts/selfhost-env.sh` writes `.env` with random secrets; sign-in links print to the log; bring your own AI key. Guide in `docs/self-host.md` (#294).
- Onboarding and Search Profile: real tabs, first-visit note, bonus context, Save then Next, inline blanks for lead-with starters, the first search waits for five answers and a resume, a clearer getting-started box and sidebar to-dos, Workplace type label, wider salary bands, new finds appear when a search ends without a reload (#251 to #256, #284, #323).
- Recruiter Analysis: scores a resume and cover letter the way a recruiter reads them, with a one-click fix for each finding (#152).
- Current pay on the profile, compared against posted ranges (#109).
- Digest: a due-soon section for pinned finds, and each find links through `/go` so clicks are counted (#304, #34).
- Admin > Metrics, Admin > Finds quality, Admin > Activity, and one-question beta surveys (switched off) (#36, #31, #35, #5).
- Link kinds for Bluesky, Threads, Mastodon and Substack (#301).

### Changed
- Sign-in sessions end after 30 days unused instead of 90 (#345).
- Privacy page: a way back into the app, a privacy@ contact address, the full subprocessor list (#251, #25).
- Plain error messages instead of "Something went wrong" (#201, #202), and a Sign out button in Settings (#197).

### Security
- Uploaded files are encrypted at rest (#16). Scripts need a per-request nonce (#14). Link fetcher, email-change link and origin check fixes (#207, #208, #209). `APP_SECRET` can rotate without losing stored secrets (#244).

### Fixed
- Accessibility: focus stays in dialogs, contrast, skip link, focus outlines, keyboard access to finds (#211 to #215).
- Revising an application no longer wipes edits saved while it ran (#200). Device names for iPhone browsers and Opera (#297).

## [0.4.0] - 2026-11-02

### Added
- Auto-applying stage: a find queued for auto-apply shows it on the board and in the spreadsheet export; canceling the application moves it back to Not applied. Finds with an open application were moved to it (#182).
- Email to any address at lookout.ericdevlin.co can be received and stored for an agent to read; nothing is sent from it. Off on production until it is configured (#178).

### Changed
- Closed, Ghosted, Not selected and Nope archive the find automatically, from the board or anywhere else that sets the stage (#180).
- Auto-apply page names the Firefox extension as the way to send (#188).

### Fixed
- Auto-apply failed at "master-resume: model did not return valid JSON": the model's thinking used up the reply budget and cut long answers off. JSON calls now turn thinking off, and a cut-off reply is retried with more room (#188).

## [0.3.0] - 2026-10-31

Auto-apply reaches production, switched on for admins only (Eric). Server-side submit stays off: applications end in the Firefox extension, where you press Submit.

### Added
- Auto-apply, end to end: read each application's form (Greenhouse, Ashby, any page via the model), draft every item with versions, notes and sources, then review, revise and approve (#39, #40, #41).
- Lookout Autofill, a signed Firefox extension: fills an approved application on the job's own page, you press Submit, and it marks the application Submitted when the thank-you page shows (#169, #172). Handles "select any that apply" questions and Greenhouse's phone Country picker (#165, #167).
- Manual submit: checklist, and resume and cover letter as ATS-safe Word files (#42).
- Resume templates (Classic, Modern, Cool) with a 10-second layout, and a master resume rebuilt once from your upload, checked against the LinkedIn PDF, fixable on Materials (#129, #131, #137).
- Keyword choices: include or leave out each keyword, with the posting line and your own line as evidence (#121).
- Salary questions show a suggested ask inside the posted range, with the math in a tooltip (#139).
- Saved application answers, reused on later forms and editable on the profile (#108).
- Voluntary EEO answers, set once with consent, encrypted, never sent to an AI (#122).

### Changed
- Drafts keep your level of ownership, keep each accomplishment with its role, ignore posting boilerplate, and never claim the posting's title as yours (#114, #129).
- Rate limits live in Postgres, so they survive restarts (#15).
- CI on every PR: typecheck, lint, tests, npm audit, Semgrep and gitleaks (#17).

### Security
- Trap instructions in postings: hidden text removed, "include the word X" cut and shown to you, trap words in drafts flagged (#116).

## [0.2.0] - 2026-10-17

### Added
- Pay listed at the bottom of a posting is found: Lookout reads the posting's structured salary, Greenhouse pay ranges and "$X - $Y" text on the full page, before trimming it for the model (#68).
- Postings that come down close themselves: each search re-checks open finds, and one confirmed gone on two searches at least 20 hours apart moves to Closed, is archived, and gets a dated note. Applied, Interview and Offer are never touched (#70).
- "Nope" stage, which also archives the find (#55).
- Admins can open a read-only view of a person's board, for testing during the beta. Each view is logged, and the privacy page says so (#47).

### Changed
- Previous and next buttons sit outside the drawer's left edge instead of in its header; arrow keys still work (#48).
- Row pin and archive icons stay quiet until hover and turn red when active, so the match score leads the row (#57, #72).

### Fixed
- The stage menu was cut off on short lists such as Archive (#56).

## [0.1.1] - 2026-10-15

### Fixed
- Notes count only when they're feedback about how Lookout reads you; other notes no longer go into searches (#49).
- Replies to Lookout emails reach a real inbox instead of disappearing (#64).

## [0.1.0] - 2026-10-14

First tagged release of the invite-only beta.

### Added
- Board, find drawer, profile, materials and settings; magic-link sign-in; invite-only access with requests and admin approval.
- Search pipeline on open models with a saved search profile ("What Lookout sees"), live progress and an after-search report with tips.
- Resume, LinkedIn PDF and links read into the profile; "Not a fit" reasons feed later searches.
- Email via Resend, nightly encrypted backups, privacy page.
- Notes save after a pause or when the drawer closes; the drawer slides in and out; previous and next between finds.

### Changed
- Auto-apply is staging-only behind `FEATURE_AUTO_APPLY`.

[Unreleased]: https://github.com/ericseandevlin/lookout/compare/v0.2.0...main
[0.2.0]: https://github.com/ericseandevlin/lookout/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ericseandevlin/lookout/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ericseandevlin/lookout/releases/tag/v0.1.0
