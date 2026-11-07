# Lawyer review brief (#22)

The packet for a flat-fee review of Lookout's Terms and Privacy Policy by a tech and privacy lawyer licensed in New York, before anyone outside the invite list signs up. Agents wrote this; it is not legal advice. The lawyer's answers are what count.

## What to send

| Item | Where |
| --- | --- |
| Terms of Service (beta, version 2026-11-07) | `/terms`, source `src/app/terms/page.tsx` |
| Privacy Policy (version 2026-11-07) | `/privacy`, source `src/app/privacy/page.tsx` |
| How consent is collected | Clickwrap box at sign-up; the accepted versions and time are stored per user, and everyone is asked again when a version changes (`src/lib/legal.ts`, #21) |
| Data inventory | README, "Product, page by page", and the "What it keeps" list on the privacy page |
| Subprocessors | Privacy page, "Services it uses": OpenRouter and the model host, Resend, the hosting provider, AWS S3. Full list with DPAs is #25 |
| Auto-apply design | `docs/auto-apply.md`, plus #29 |
| Retention and backups | README "Backups", `deploy/backup.sh`, `src/lib/retention.ts`, #26 |
| Breach plan | `docs/incident-response.md` |

Export the two pages to PDF from staging so the lawyer reads exactly what users see.

## Facts the lawyer will ask for

- **Who runs it:** Eric Devlin, as an individual. No LLC yet (#23). The Terms name him personally.
- **Users:** invite-only beta, adults, mostly US. No payments yet.
- **Data:** contact details, resumes, LinkedIn PDFs, career answers, job search activity, in-app usage events, and click tracking on the finds email. No payment data, no government IDs. Auto-apply drafts may include work authorization, EEO and salary answers.
- **Where it lives:** one Hostinger VPS, and encrypted backups in AWS S3 (`eric-site-backups`). Confirm both regions before sending.
- **AI:** profile and resume text goes to models through OpenRouter, with providers that keep or train on data blocked (#24).
- **Admin access:** Eric can open a logged, read-only view of any user's board and can reach the database directly. The privacy page says so.

## Questions to ask

1. **NY SHIELD Act.** What "reasonable safeguards" duties apply to a one-person beta, and is the breach plan in `docs/incident-response.md` enough for the notice rules (who, how fast, what to say)?
2. **CCPA/CPRA and other state laws.** Lookout is far below the CCPA thresholds today. Does anything still apply (for example if a California user joins), and what should the privacy page say now so it doesn't need a rewrite later?
3. **Auto-apply liability.** Lookout submits applications in the user's name after they approve each one. Is the Terms language enough ("you are the applicant", responsibility for accuracy, site terms)? What exposure is there if a job site's terms forbid automated submission, or if a submitted answer is wrong?
4. **Sensitive answers.** Auto-apply can hold EEO, disability, veteran and work authorization answers. Do these need separate consent or different handling?
5. **Personal liability.** With no LLC, is the limitation of liability ($50 or 12 months of fees) worth much? Should the Terms wait for #23, or ship now and be re-signed under the LLC?
6. **Disputes.** The Terms pick New York law and NY courts. Should they add arbitration, a class action waiver, or a small claims carve-out?
7. **Click and usage tracking.** Lookout records page views, time on page and finds-email link clicks itself, with no outside scripts. Is the disclosure enough, and is a cookie banner needed for this?
8. **Admin access.** Is the read-only board view during the beta fine as disclosed, or does it need an opt-in?
9. **Changes to the terms.** Re-consent on the next visit after a version bump. Is that enough notice, or should changes also be emailed?
10. **Missing pieces.** Anything the lawyer expects to see that isn't there, such as a copyright takedown contact, a children's privacy line, a data location statement or an accessibility statement.

## Gaps found while preparing this

Fix these, or ask the lawyer about them, so the pages stay true:

- **Backups.** The privacy page says backups are encrypted and kept up to 60 days in S3. They also sit on the server for 14 days and on Eric's Mac for 30 days, and those two copies are not encrypted beyond the database dump format and disk security (uploaded files are encrypted). The "Delete everything" line says copies "age out within 60 days", which is true overall but doesn't mention the other copies. Either describe all three or encrypt the server and Mac copies.
- **Subprocessors.** The hosting provider is not named on the privacy page. #25 covers naming it and keeping DPAs.
- **Contact address.** Both pages point to `privacy@lookout.ericdevlin.co`. Confirm that inbox is read, since the SHIELD Act and any state law requests depend on it.
- **Inactive accounts.** #26 plans warnings at 12 months and deletion at 18. That isn't built or stated on the privacy page yet.

## After the review

- Change the pages as advised, bump `TERMS_VERSION` and `PRIVACY_VERSION` in `src/lib/legal.ts` so everyone agrees again, and drop the "draft until the lawyer review" note in `src/app/terms/page.tsx`.
- Record the advice and the date in `docs/decisions/` (no fees or personal details).
- Close #22, and update #23, #25, #26 and #29 with anything the lawyer said about them.
