# Every screen in Lookout

The owner's list of every page: its address, who can open it, what it does, and whether production hides it. For what each feature is and where it stands, see [features.md](features.md). For how the screens connect, see the diagrams in [flows.md](flows.md). For why each page exists and whether it ships, see [screen-audit.md](screen-audit.md).

Checked against the code on 2026-11-16. Production is release v0.6.2. `main` is what runs on staging.

A test (`src/app/screensDoc.test.ts`) fails when a page under `src/app` has no row here, or a row here points at a page that no longer exists. So when you add a page, add its row.

## How to read this

- **Who sees it.** *Anyone*: no sign-in. *Signed in*: has an account, finished the welcome step and agreed to the current Terms and Privacy (`src/app/(app)/layout.tsx` sends everyone else away). *Admin*: an email in `ADMIN_EMAILS` (`src/app/(app)/admin/layout.tsx` shows everyone else a 404).
- **Switch.** A feature switch is an env var on the server (`FEATURE_...=on`), read in `src/lib/features.ts`. Off means the page answers 404. Every switch is off unless the server's `.env` turns it on (`deploy/env.example`).
- **Production switches today:** `FEATURE_PREVIEW` on, `FEATURE_AUTO_APPLY` on (admins only, by code), `FEATURE_AUTO_SUBMIT` off, `FEATURE_EVENTS` off, `FEATURE_SEARCHES` off, `FEATURE_WAITLIST` off, `FEATURE_DEMO` off, `FEATURE_INTERVIEW` off. The server's `.env` is the final word.
- **Code** is the page file under `src/app` and the component that draws it, under `src/components`.

## Public pages

| URL | Who sees it | What it does | Switch on production | Code |
|---|---|---|---|---|
| `/` | Anyone. Signed-in people go to their board unless they add `?view=1`. | The one-page marketing site: headline, product video, Request access and Sign in. A `?ref=` tag is kept so Admin > Metrics can count where people came from. | None. With `FEATURE_WAITLIST` on, it also links `/jobs` and `/what-it-finds`. | `src/app/page.tsx`, `src/components/landing/Landing.tsx` |
| `/signin` | Anyone. Signed-in people go to their board unless they add `?view=1`. | Type your email, get a sign-in link. There are no passwords. Sign-out lands here. | None | `src/app/signin/page.tsx`, `src/components/Login.tsx` |
| `/request-access` | Anyone not signed in. | The waitlist form. When sign-up is invite only, it asks for an invite; when it is open, it signs you up. Has the bot check (Turnstile) when keys are set. | None. `FEATURE_WAITLIST` adds the "what would you search for" question and a confirm email. | `src/app/request-access/page.tsx`, `src/components/Login.tsx` |
| `/join/[code]` | Anyone with the link. Signed-in people see it too, with a note. | A group invite link. Each email takes one seat and gets a sign-in link, until the link expires, fills up or an admin closes it. | None | `src/app/join/[code]/page.tsx` |
| `/auth/verify` | Anyone with a sign-in link. | Where the sign-in link lands. Signs you in, and asks for the Terms and Privacy agreement first if it is due. | None | `src/app/auth/verify/page.tsx`, `src/components/Verify.tsx` |
| `/auth/confirm-email` | Anyone with the link. | Where the "confirm your new email" link lands after someone changes their email in Settings. | None | `src/app/auth/confirm-email/page.tsx`, `src/components/ConfirmEmail.tsx` |
| `/unsubscribe` | Anyone with the link. | One button to stop an email list. The finds email links here. | None | `src/app/unsubscribe/page.tsx`, `src/components/Unsubscribe.tsx` |
| `/terms` | Anyone | Terms of Service for the beta. A draft until the lawyer review (#22). | None | `src/app/terms/page.tsx`, `src/components/LegalPage.tsx` |
| `/privacy` | Anyone | What Lookout keeps and who sees it, in plain words. | None | `src/app/privacy/page.tsx`, `src/components/LegalPage.tsx` |
| `/next` | Anyone with the address. Not indexed by search engines. | "What's next": a demo page of features still being built, each marked On staging, Building or Idea. | `FEATURE_PREVIEW`. **On** in production. | `src/app/next/page.tsx` |
| `/jobs` | Anyone | Marketing page for job search. | `FEATURE_WAITLIST`. Off. Also not on production yet (added after v0.6.2, #9). | `src/app/jobs/page.tsx`, `src/components/landing/JobsPage.tsx` |
| `/what-it-finds` | Anyone | Marketing page about the kinds of things Lookout can look for beyond jobs. | `FEATURE_WAITLIST`. Off. Also not on production yet (#9). | `src/app/what-it-finds/page.tsx`, `src/components/landing/KindsPage.tsx` |
| `/waitlist/confirm` | Anyone with the link. | Where the waitlist confirm email lands. One button confirms the email (double opt-in). | Only reachable when `FEATURE_WAITLIST` sends that email. Not on production yet (#9). | `src/app/waitlist/confirm/page.tsx`, `src/components/ConfirmWaitlist.tsx` |
| `/demo` | Anyone. Not indexed. | A read-only board for a made-up person, Maya Ortiz, with made-up companies. Nothing a visitor does is saved. | `FEATURE_DEMO`. Off; meant for staging only. Not on production yet (#1317). | `src/app/demo/page.tsx`, `src/lib/demo.ts`, `src/components/Finds.tsx` |

## Getting in (signed in, before the app)

| URL | Who sees it | What it does | Switch on production | Code |
|---|---|---|---|---|
| `/welcome` | Signed in, first visit only. Everyone else goes to the board. | The welcome step: your name, the agreement box, and the first questions for the kind of search you picked. | None | `src/app/welcome/page.tsx`, `src/components/Welcome.tsx` |
| `/consent` | Signed in, when the Terms or Privacy version changed since you agreed. | Asks you to agree again. Everyone else goes to the board. | None | `src/app/consent/page.tsx`, `src/components/Consent.tsx` |

## The app (signed in)

All of these sit inside the app shell: the sidebar on desktop, the bottom bar on phones (`src/components/Shell.tsx`).

| URL | Who sees it | What it does | Switch on production | Code |
|---|---|---|---|---|
| `/finds` | Signed in | The board. Every find with its score, pay, stage and location. Open one to see why it matched, set a stage, pin it, add notes, or mark it Not a fit. Also: Search now, Add a link, the live search panel and the first-week tips. | None | `src/app/(app)/finds/page.tsx`, `src/components/Finds.tsx`, `src/components/finds/` |
| `/events` | Signed in | Meetups, panels and conferences that fit your field, found with each search, on their own board. | `FEATURE_EVENTS`. Off. The sidebar link is hidden too. | `src/app/(app)/events/page.tsx`, `src/components/Events.tsx`, `src/components/events/EventsBoard.tsx` |
| `/profile` | Signed in | Search profile, Questions tab: the five profile questions that steer every search. | None | `src/app/(app)/profile/page.tsx`, `src/components/Profile.tsx` |
| `/profile/materials` | Signed in | Resume upload, LinkedIn PDF, links, and the master resume Lookout builds from them. | None | `src/app/(app)/profile/materials/page.tsx`, `src/components/Materials.tsx` |
| `/profile/sees` | Signed in | "What Lookout sees": the short summary of you that searches actually use. | None | `src/app/(app)/profile/sees/page.tsx`, `src/components/SearchProfileView.tsx` |
| `/profile/knows` | Signed in | "What Lookout knows": every fact from the interview, setup answers and resume, with its source and quote, a Shareable or Private switch, Edit and Delete. Facts that name a person or a complaint start Private and say why. | `FEATURE_INTERVIEW`. Off. Staging only (#1449). | `src/app/(app)/profile/knows/page.tsx`, `src/components/Knows.tsx` |
| `/interview` | Signed in | The interview: one question at a time, typed answers, Skip, Doesn't apply and Stop for today. The first turns are the setup questions still unanswered; then each question comes from a gap in the top 5 finds. Saved facts show inline. | `FEATURE_INTERVIEW`. Off. Staging only (#1449). | `src/app/(app)/interview/page.tsx`, `src/components/Interview.tsx` |
| `/profile/application` | Admin, with `FEATURE_AUTO_APPLY` on. Everyone else gets a 404. | Application answers: saved answers, personal stories, current pay and voluntary EEO answers that auto-apply reuses. | `FEATURE_AUTO_APPLY`. On, so admins see it. | `src/app/(app)/profile/application/page.tsx`, `src/components/SavedAnswers.tsx` |
| `/materials` | Signed in | Old address. Sends you to `/profile/materials`. | None | `src/app/(app)/materials/page.tsx` |
| `/apply` | Admin, with `FEATURE_AUTO_APPLY` on. | Auto-apply list: every application Lookout is drafting or has drafted, plus the Firefox extension setup. | `FEATURE_AUTO_APPLY`. On, admins only. | `src/app/(app)/apply/page.tsx`, `src/components/Apply.tsx` |
| `/apply/[id]` | Admin, with `FEATURE_AUTO_APPLY` on. | Review one application: resume and cover letter drafts with versions, keyword choices, Recruiter Analysis, form answers, and the way to send it. | `FEATURE_AUTO_APPLY`. On, admins only. Submit for me needs `FEATURE_AUTO_SUBMIT`, which is off. | `src/app/(app)/apply/[id]/page.tsx`, `src/components/ApplicationReview.tsx`, `src/components/review/` |
| `/settings` | Signed in | Name, email, the finds email, signed-in devices, sign out, Invite a friend, search schedule, Search now, board options, Terms, Privacy, Export, Reset board, Delete everything. | None. Invite a friend is on `main` only (#527). | `src/app/(app)/settings/page.tsx`, `src/components/Settings.tsx` |

## Admin

Every admin page has the same tabs across the top (`src/components/admin/shared.tsx`).

| URL | Who sees it | What it does | Switch on production | Code |
|---|---|---|---|---|
| `/admin` | Admin | People: who can sign up, daily spend caps, invites (one or many), group links, access requests (with CSV download on `main`), the email inbox, every account and recent searches. | None | `src/app/(app)/admin/page.tsx`, `src/components/admin/People.tsx` |
| `/admin/ai` | Admin | AI settings: the model provider, model, key, price, data privacy level, the web search engine, and a link tester. | None | `src/app/(app)/admin/ai/page.tsx`, `src/components/admin/Ai.tsx` |
| `/admin/surveys` | Admin | Write one-question surveys, switch them on or off, preview them, and read the answers. | None | `src/app/(app)/admin/surveys/page.tsx`, `src/components/AdminSurveys.tsx` |
| `/admin/quality` | Admin | Finds quality: what people did with the finds Lookout added, so a model or prompt change can be judged. | None | `src/app/(app)/admin/quality/page.tsx`, `src/components/AdminQuality.tsx` |
| `/admin/activity` | Admin | Activity: what people do in the app, from Lookout's own events, plus a funnel. | None | `src/app/(app)/admin/activity/page.tsx`, `src/components/AdminActivity.tsx` |
| `/admin/metrics` | Admin | Metrics: the beta goals and where each stands, weekly numbers, growth by channel and referrals. | None | `src/app/(app)/admin/metrics/page.tsx`, `src/components/AdminMetrics.tsx` |
| `/admin/errors` | Admin | Server errors from the last 30 days, searchable. | None | `src/app/(app)/admin/errors/page.tsx`, `src/components/AdminErrors.tsx` |
| `/view/[userId]` | Admin | Someone else's board exactly as they see it, read only. Each view is logged. | None | `src/app/view/[userId]/page.tsx`, `src/components/Finds.tsx` |

## Pages that are not in a list above

- **Error pages.** A missing page or a crash shows Lookout's own page with a reference number, never the error itself: `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`.

## Addresses with no screen (API and links)

These answer with data or a redirect, not a page. Grouped by folder under `src/app`.

- `/api/auth/*`: sign-in links, sign out, request access, group join, email change confirm, waitlist confirm.
- `/api/account/*`: change email, signed-in devices, delete account, your referral link.
- `/api/state`, `/api/me`, `/api/settings`, `/api/profile/*`, `/api/search-profile`, `/api/materials/*`: what the board, profile, materials and settings pages read and save.
- `/api/finds/*`, `/api/board/reset`, `/api/export`: change a find, add a link, reset the board, download your data.
- `/api/searches/*`, `/api/runs/*`: your searches, starting a search now, and the live progress of a run.
- `/api/networking-events/*`: the Events board (needs `FEATURE_EVENTS`).
- `/api/apply/*`: auto-apply drafts, revisions, Word downloads, keyword choices, form fill and marking sent (admins with `FEATURE_AUTO_APPLY`).
- `/api/ext/*`: the Firefox extension. It matches the page you are on, fetches the approved application, and marks it sent.
- `/api/admin/*`: everything the admin pages read and change.
- `/api/agent/*`: for agents outside the app, with a bearer token. The search queue for Claude agent mode, the email inbox, and on staging only, server errors and bad AI results.
- `/api/inbound/resend`: receives email sent to the app's domain (a webhook from Resend).
- `/api/consent`, `/api/welcome`, `/api/survey`, `/api/events`, `/api/unsubscribe`: the agreement box, the welcome step, survey answers, Lookout's own usage events, and one-click unsubscribe.
- `/api/health`: the uptime check reads this.
- `/go/[digest]/[target]`: links in the finds email. Counts the click, then sends you on.
