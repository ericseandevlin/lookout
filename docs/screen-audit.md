# Screen audit

Does every page have a reason to exist, and does production show only finished work? Part of #45. Audit issue: #1341.

Checked against `main` (staging) on 2026-11-18. The full list of pages, with who sees each and its code, is [screens.md](screens.md); this page only records the decision for each.

**Decisions:** *Keep*: finished, has a job. *Gated*: half-built or not launched; a `FEATURE_` switch keeps it off on production already. *Merge*: fold into another page. No page needs removing, and no page needed a new switch.

## Public pages

| URL | Why it exists | Decision |
|---|---|---|
| `/` | The front door: what Lookout is, Request access, Sign in. | Keep |
| `/signin` | The only way in. | Keep |
| `/request-access` | Waitlist and open sign-up. | Keep |
| `/join/[code]` | Group invites for a class or meetup. | Keep |
| `/auth/verify` | Where sign-in links land. | Keep |
| `/auth/confirm-email` | Confirms an email change. | Keep |
| `/unsubscribe` | Legal must for the finds email. | Keep |
| `/terms`, `/privacy` | Legal must. Terms stays marked draft until #22. | Keep |
| `/next` | A roadmap page for demos and contributors. Describes future work, does not run it. Not indexed. | Keep. On in production today (`FEATURE_PREVIEW`); one switch takes it down. |
| `/jobs`, `/what-it-finds` | Marketing pages for the open waitlist. | Gated (`FEATURE_WAITLIST`, off) |
| `/waitlist/confirm` | Double opt-in for the waitlist. | Gated (`FEATURE_WAITLIST`, off) |
| `/demo` | Read-only sample board, for staging. | Gated (`FEATURE_DEMO`, off) |

## Getting in

| URL | Why it exists | Decision |
|---|---|---|
| `/welcome` | First-run setup and the agreement box. | Keep |
| `/consent` | Agreeing again when Terms or Privacy change. | Keep |

## The app

| URL | Why it exists | Decision |
|---|---|---|
| `/finds` | The board. The product. | Keep |
| `/events` | Events board. Not finished. | Gated (`FEATURE_EVENTS`, off; sidebar link hidden too) |
| `/profile` | The five questions that steer searches. | Keep |
| `/profile/materials` | Resume, LinkedIn and links. | Keep |
| `/profile/sees` | Shows the summary searches use, so people can trust and correct it. Small, but it answers "why did it find this". | Keep (could merge into `/profile` later; not worth a change now) |
| `/profile/application` | Auto-apply's saved answers. | Gated (admins with `FEATURE_AUTO_APPLY`) |
| `/materials` | Redirect from the old address, so old links and emails still work. | Keep as a redirect |
| `/apply`, `/apply/[id]` | Auto-apply list and review. | Gated (admins with `FEATURE_AUTO_APPLY`; Submit for me also needs `FEATURE_AUTO_SUBMIT`, off) |
| `/settings` | Account, schedule, data. | Keep |

The search switcher and kind picker (`FEATURE_SEARCHES`) are parts of pages, not pages, and are off on production.

## Admin

All admin pages answer 404 to anyone not in `ADMIN_EMAILS`, so they never show to a person using Lookout.

| URL | Why it exists | Decision |
|---|---|---|
| `/admin` | Access, invites, accounts. | Keep |
| `/admin/ai` | Model and search engine settings. | Keep |
| `/admin/surveys` | One-question surveys. | Keep |
| `/admin/quality` | Judging model or prompt changes. | Keep |
| `/admin/activity` | Usage and funnel. | Keep |
| `/admin/metrics` | Beta goals and growth. | Keep |
| `/admin/errors` | Server errors. | Keep |
| `/view/[userId]` | Support: see someone's board as they do. Logged. | Keep |

## Auto-apply on production

The #45 checklist says auto-apply stays staging-only for the public. On production it is on only for admins: `canUseAutoApply` in `src/lib/apply.ts` needs both `FEATURE_AUTO_APPLY=on` and an admin email, and Submit for me is off. No one outside `ADMIN_EMAILS` can reach it, so this meets the rule without a change.

## What would change this

- A new page needs a row in [screens.md](screens.md) (the test in `src/app/screensDoc.test.ts` enforces it) and a decision here.
- A half-built page ships behind a `FEATURE_` switch in `src/lib/features.ts`, off by default.
