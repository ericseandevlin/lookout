# Every feature in Lookout, and where it stands

The owner's map: what Lookout can do, where each piece lives, and whether it is on production. For every page and its address, see [screens.md](screens.md). For how the pieces connect, see the diagrams in [flows.md](flows.md). For the folders, see [architecture.md](architecture.md).

Checked against the code on 2026-11-16. Numbers like (#527) are GitHub issues.

## The five statuses

- **Live on production.** In release v0.6.2 (commit `8b7a623`), which is what lookout.ericdevlin.co runs, and switched on.
- **On staging only.** Merged to `main` after v0.6.2. Staging runs it; production gets it at the next release. Check with `git log v0.6.2..origin/main`.
- **Behind a switch.** The code is on production, but a feature switch keeps it off there. A switch is an env var like `FEATURE_EVENTS=on` in the server's `.env`, read in `src/lib/features.ts` (and `src/lib/apply.ts`, `src/lib/application/submitMode.ts` for auto-apply).
- **Built but unused.** The code exists, but nothing calls it or no screen shows it.
- **Planned.** An open issue. Nothing built yet, or only a small part.

Production switches today: `FEATURE_PREVIEW` on, `FEATURE_AUTO_APPLY` on (admins only), `FEATURE_AUTO_SUBMIT` off, `FEATURE_EVENTS` off, `FEATURE_SEARCHES` off, `FEATURE_WAITLIST` off, `FEATURE_DEMO` off, `FEATURE_INTERVIEW` off.

## At a glance

| Status | Count |
|---|---|
| Live on production | 41 |
| On staging only | 3 |
| Behind a switch (off on production) | 5 |
| Built but unused | 3 |
| Planned | 13 |

## Live on production

### Getting in

| Feature | What it does for a person | Code | Issues |
|---|---|---|---|
| Landing page | The public one-page site at `/` with a product video. | `src/app/page.tsx`, `src/components/landing/` | #600 |
| Sign-in links, no passwords | Type an email, click the link in it. Sessions end after 30 days unused. | `src/lib/auth/`, `src/app/api/auth/`, `src/components/Login.tsx` | #517, #345 |
| Invite only, with a waitlist | People ask for access; an admin approves, which sends an invite. Admins can also switch sign-up to open. | `src/app/request-access/`, `src/lib/invite.ts`, `src/components/admin/People.tsx` | #993 |
| Group invite links | One link at `/join/<code>` lets a class or meetup make accounts, with a seat cap and an end date. | `src/app/join/[code]/page.tsx`, `src/lib/groupInvite.ts` | #601, #993 |
| Bot check on the request form | Cloudflare Turnstile, when its keys are set. | `src/lib/turnstile.ts` | #13 |
| Terms, Privacy, and agreeing again | Plain-language pages. Everyone agrees on the welcome step, and again when a version changes. | `src/app/terms/`, `src/app/privacy/`, `src/app/consent/`, `src/lib/legal.ts` | #20, #21, #22, #25 |
| Welcome step | Name, agreement box, two quick picks that fill in the first profile questions. | `src/app/welcome/page.tsx`, `src/components/Welcome.tsx` | #8 |

### Searching

| Feature | What it does for a person | Code | Issues |
|---|---|---|---|
| Profile questions | Five questions that steer every search. | `src/components/Profile.tsx`, `src/lib/kinds/index.ts` | |
| Resume, LinkedIn PDF and links | Upload them; Lookout reads them into your profile. Uploaded files are stored encrypted. | `src/components/Materials.tsx`, `src/lib/agent/resume.ts`, `src/lib/agent/links.ts`, `src/lib/files.ts` | #16, #301 |
| Current pay | Your current pay, compared against posted ranges. | `src/components/CurrentComp.tsx`, `src/lib/currentComp.ts` | #109 |
| "What Lookout sees" | The short summary of you that searches use. You can read it. | `src/components/SearchProfileView.tsx`, `src/lib/agent/searchProfile.ts` | |
| The search itself | Writes queries, searches the web, reads each posting, scores it 1 to 5 with a plain reason, applies your hard rules (pay floor, dealbreakers), and adds matches to the board. | `src/lib/agent/discover.ts`, `src/lib/agent/rules.ts`, `src/lib/ai/` | #740, #862 |
| Scheduled searches | Runs on your chosen days, once per local day, 3 people at a time. | `src/lib/scheduler.ts` | #988, #1222 |
| Search now | Run a search right away, up to 3 a day. Live progress shows on the board, then a short report with tips. | `src/components/SearchPanel.tsx`, `src/components/finds/SearchNowButton.tsx`, `src/lib/runState.ts` | |
| Not a fit feedback | Your "Not a fit" reasons and notes about how Lookout reads you go into later searches. | `src/lib/agent/searchProfile.ts` | #49 |
| Closed postings close themselves | Each search re-checks open finds. One gone twice, 20+ hours apart, moves to Closed. Applied and later stages are never touched. | `src/lib/agent/linkCheck.ts`, `src/lib/agent/linkState.ts` | #70 |
| Spend caps and alerts | Searches stop at a daily total and a per-person cap. Admins get an email before and when that happens. | `src/lib/ai/runs.ts`, `src/lib/spend.ts`, `src/lib/spendAlerts.ts` | #990, #1038 |
| AI choice and privacy | Any OpenAI-compatible model, set in Admin > AI. Strict mode uses only hosts that keep nothing. | `src/lib/ai/llm.ts`, `src/lib/config.ts`, `src/components/admin/Ai.tsx` | |
| AI tracing | Each AI call carries its step name and a scrambled person ID, so cost and failures can be traced. No names or text are sent. | `src/lib/ai/trace.ts` | #985 |

### The board

| Feature | What it does for a person | Code | Issues |
|---|---|---|---|
| Finds board and drawer | Every find with score, pay, stage, location. Open one for the reason, stage, pin, notes. Previous and next with arrow keys. | `src/components/Finds.tsx`, `src/components/finds/` | #48, #57 |
| Stages and archive | Stages from Not applied to Offer. Closed, Ghosted, Not selected and Nope archive the find. | `src/lib/kinds/index.ts`, `src/lib/board.ts` | #55, #180 |
| Add a link | Paste a posting you found yourself; Lookout reads and scores it. | `src/components/finds/AddLink.tsx`, `src/app/api/finds/route.ts` | |
| First-week tips | A tips card on the board for new people. | `src/components/finds/FirstWeek.tsx`, `src/lib/firstWeek.ts` | #992 |
| Finds email | After each search, a short email of new finds, with a due-soon section. Clicks go through `/go` so they are counted. One-click unsubscribe. | `src/lib/digest.ts`, `src/app/go/`, `src/lib/emailRules.ts` | #28, #34, #304 |
| Settings and your data | Schedule, email on or off, devices, change email, Export, Reset board, Delete everything. | `src/components/Settings.tsx`, `src/app/api/account/`, `src/app/api/export/` | #197 |

### Auto-apply (admins only on production)

`FEATURE_AUTO_APPLY` is on in production, and the code also requires an admin (`canUseAutoApply` in `src/lib/apply.ts`). So today only Eric uses it. Spec: [auto-apply.md](auto-apply.md).

| Feature | What it does for a person | Code | Issues |
|---|---|---|---|
| Drafted applications | Reads the posting's form, drafts the resume, cover letter and every answer, with versions, notes and sources. | `src/lib/application/run.ts`, `src/lib/application/draft.ts`, `src/lib/application/scan.ts` | #39, #40, #41 |
| Review page | Edit, revise, go back a version, approve. Keyword choices with evidence, and a suggested salary ask. | `src/components/ApplicationReview.tsx`, `src/components/review/` | #121, #139, #738 |
| Recruiter Analysis | Scores the resume and letter the way a recruiter reads them, with a one-click fix for each finding. | `src/lib/application/review.ts`, `src/components/review/RecruiterPanel.tsx` | #152 |
| Master resume and templates | One master resume rebuilt from your upload, checked against LinkedIn, in three templates, downloadable as Word. | `src/lib/application/master.ts`, `src/lib/application/docx.ts` | #129, #131, #137, #780 |
| Saved answers, stories and EEO | Answers reused on later forms; personal stories for cover letters; voluntary EEO answers, encrypted and never sent to an AI. | `src/components/SavedAnswers.tsx`, `src/lib/application/saved.ts`, `src/lib/application/stories.ts`, `src/lib/application/eeo.ts` | #108, #122 |
| Firefox extension | Fills the approved application on the job's own page. You press Submit. It marks the find Applied when the thank-you page shows. | `extension/firefox/`, `src/lib/extension/`, `src/app/api/ext/` | #169, #172 |
| Manual submit | A two-minute checklist and ATS-safe Word files, for sites the extension should not touch. | `src/components/review/Checklist.tsx` | #42 |
| Posting traps | Hidden text and "include the word X" tricks in postings are cut and shown to you. | `src/lib/application/posting.ts` | #116 |

### Admin and running it

| Feature | What it does | Code | Issues |
|---|---|---|---|
| Admin > People | Access, caps, invites, group links, requests, every account, recent searches. | `src/components/admin/People.tsx`, `src/app/api/admin/` | #993 |
| View someone's board | Read-only, logged, and the privacy page says so. | `src/app/view/[userId]/page.tsx` | #47 |
| Metrics, Quality, Activity | Beta goals, what people did with finds, and Lookout's own usage events. No third-party trackers. | `src/lib/metrics.ts`, `src/lib/quality.ts`, `src/components/track.ts`, `src/app/api/events/` | #31, #35, #36, #526 |
| Surveys | One question at a time, shown at most every few days. Only runs when an admin switches a question on. | `src/lib/survey.ts`, `src/lib/surveyStore.ts`, `src/components/SurveyDialog.tsx` | #5, #37, #836 |
| Errors | Server errors kept 30 days in Admin > Errors. | `src/lib/errorLog.ts` | #12 |
| Coming-next page | `/next` lists features being built, for demos. | `src/app/next/page.tsx` | #602 |
| Safety and upkeep | Daily cleanup and retention, rate limits in Postgres, CSP with nonces, uptime check, health check with low-disk warning, nightly encrypted backups. | `src/lib/retention.ts`, `src/lib/ratelimit.ts`, `src/lib/csp.ts`, `src/app/api/health/`, `deploy/backup.sh` | #12, #14, #15, #995 |
| Self-hosting | Anyone can run their own copy with one compose file. | `compose.yaml`, [self-host.md](self-host.md) | #294 |

## On staging only (merged after v0.6.2)

| Feature | What it does for a person | Code | Issues |
|---|---|---|---|
| Referral links | Settings > Invite a friend shows your own link. People who join through it are tagged as your referral, and Admin > Metrics counts them. Not behind a switch, so it ships with the next release. | `src/lib/referral.ts`, `src/app/api/account/referral/` | #527 |
| Waitlist CSV | Admin > People downloads every access request as a spreadsheet. Not behind a switch. | `src/app/api/admin/requests/export/`, `src/lib/waitlist.ts` | #9 |
| Waitlist pages and double opt-in | `/jobs`, `/what-it-finds`, a "what would you search for" question, and a confirm email. Also behind `FEATURE_WAITLIST`, so it stays off on production even after release until Eric turns it on. | `src/components/landing/JobsPage.tsx`, `src/components/landing/KindsPage.tsx`, `src/lib/waitlist.ts`, `src/app/waitlist/confirm/` | #9 |

The public demo (`/demo`, #1317) also merged after v0.6.2; it is listed under switches below.

## Behind a switch (off on production)

| Feature | Switch | What it does for a person | Code | Issues |
|---|---|---|---|---|
| Events | `FEATURE_EVENTS` | Meetups, panels and conferences that fit your field, on their own board, found with each search. | `src/components/Events.tsx`, `src/lib/networking.ts`, `src/lib/agent/networking.ts`, `src/app/api/networking-events/` | #7, #264, #265 |
| Several searches and the kind picker | `FEATURE_SEARCHES` | More than one search per account, a switcher in the sidebar, and picking the kind at sign-up. | `src/lib/searches.ts`, `src/components/SearchSwitcher.tsx` | #8 |
| RFP searches | `FEATURE_SEARCHES` (it is a kind you pick) | Government contract opportunities from SAM.gov for freelancers and small firms, with agency, due date, value and set-aside columns. Also needs a SAM.gov key on the server. | `src/lib/agent/rfp.ts`, `src/lib/samGov.ts`, `src/lib/kinds/index.ts` | #8, #272, #300 |
| Submit for me | `FEATURE_AUTO_SUBMIT` | Lets auto-apply press Submit itself. Off, so every application ends with the person pressing Submit. | `src/lib/application/submitMode.ts`, `src/lib/application/submit.ts`, `src/components/review/SendForMe.tsx` | #42, #187 |
| Public demo board | `FEATURE_DEMO` | `/demo`: the made-up Maya Ortiz board, read only, no sign-in. Rebuilt at startup. Meant for staging. Also merged after v0.6.2. | `src/app/demo/page.tsx`, `src/lib/demo.ts` | #1317 |
| Interview and What Lookout knows | `FEATURE_INTERVIEW` | `/interview` asks one question at a time from gaps in the top 5 finds, after the setup questions still unanswered. `/profile/knows` lists every fact with its source, a Shareable or Private switch, Edit and Delete. Shareable facts count in drafts; private ones and pay never reach a drafting step. On its own branch until Eric approves. | `src/lib/interview/`, `src/components/Interview.tsx`, `src/components/Knows.tsx` | #1449 |

## Built but unused

| What | Where | Why it is unused | Issues |
|---|---|---|---|
| News mail (`sendNewsMail`) and the "news" email list | `src/lib/bulkMail.ts`, the `email_opt_outs` table in `src/lib/db/schema.ts` | Built for an in-app newsletter. Nothing calls `sendNewsMail`, and no email makes a "news" unsubscribe link, so the opt-out table stays empty. The newsletter is moving to Resend Broadcasts instead. | #28, #1322 |
| Email inbox | `src/lib/inbound/`, `src/app/api/inbound/resend/`, `src/app/api/agent/inbox/` | Receives email sent to the app's domain for an agent to read. Works only when `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` are set; it was left off on production when it shipped. The Inbox row in Admin > People only shows when mail has arrived. | #178 |
| Claude agent mode | `src/app/api/agent/queue/`, `src/app/api/agent/runs/`, the "Claude agent" provider in Admin > AI | Sends searches to Claude Code on Eric's Mac instead of running them in the app. Only works while the Mac is awake. Production uses an AI model directly. | |

## Planned

| Idea | What it would do | Issues |
|---|---|---|
| Newsletter through Resend | Eric writes each issue in Resend; Lookout only keeps Resend's contact list in step with who agreed and who opted out. | #1322 |
| Help pages | A public help section for every feature, with search. | #1330 |
| Split board on desktop | The list on the left and the open find on the right, no slide-in. | #1331 |
| Public changelog | A changelog page and a What's new link in the app. | #1332 |
| Feature ideas to pick from | Hide companies everywhere, warm intros, tracker import, keyboard shortcuts, a demo video, a feedback button, a feed for your own AI assistant. Picked ones become tickets. | #1333 |
| Redraft fix | Redraft on the resume looks dead when keywords are not approved yet. A bug. | #1334 |
| Feedback box | User feedback becomes a private task, and the person hears back when it is fixed. | #1335 |
| This map | These two pages and the check that keeps them current. | #1336 |
| Search fallback | When SearXNG fails or finds nothing, retry on a paid search API. The client already exists in `src/lib/ai/search.ts`; the fallback does not. Needed before about 30 active people. | #987 |
| Load test | 50 made-up accounts searching in one morning on staging, to find the first limit. | #989 |
| Staging traces and weekly bad-results review | Full prompt and reply text on staging only, reviewed weekly. Partly built: `/api/agent/bad-results` and [ai-review.md](ai-review.md) exist; the staging key and review loop do not. | #994 |
| Grants and fellowships | A new kind of find. | #302 |
| Speaking slots and calls for papers | A new kind of find. | #303 |
