# Incident and breach response

What to do if Lookout's data or keys may have leaked. Production runs on one VPS in `/opt/lookout`; every command below runs there as root, from that directory, unless it says otherwise. Eric runs this plan. Agents have no root or Docker access on the server, so they can check the plan and the code but not run these commands, on staging or prod.

Keep notes as you go: what you saw, when, and what you did. Times in UTC.

## 1. How we'd notice

- **Someone tells us.** A tester, a provider, or a report to the address in [SECURITY.md](../SECURITY.md).
- **A provider alert.** OpenRouter, Resend or AWS emails about unusual use or a leaked key. GitHub secret scanning or gitleaks in CI flags a committed key.
- **Spend we can't explain.** The daily budget cap (`DAILY_BUDGET_USD`) starts refusing work, or the admin page shows cost or runs nobody started.
- **Odd sign-ins.** Sessions in the `sessions` table with user agents or times that don't fit, or a burst of sign-in emails.
- **The server itself.** Unknown processes, users or SSH keys, changed files in `/opt/lookout`, or `/api/health` failing for no clear reason.

If it's a vulnerability with no sign anyone used it, fix it the normal way (issue, PR, staging, release) and skip to step 6.

**Only a provider key leaked** (for example OpenRouter reports use you don't recognize) and nothing else looks wrong: do step 2.1, rotate just that key (step 2.4), check the provider's usage page for when it started, then go to step 3. Sign-outs and the other keys can wait unless step 3 finds more.

## 2. First hour: contain

Do these in order. Don't delete anything yet; logs and the database are evidence.

1. **Snapshot first.** Run `/opt/lookout/backup.sh`, then rename the new files in `backups/` (add `-incident`) so the nightly run can't overwrite them the same day. Save the logs with `docker compose logs --since 72h app > incident-app.log`. Copy all three somewhere off the server.
2. **Close the door if it's still open.** If the server or app looks taken over, stop the app: `docker compose stop app`. People lose access until it's back, which is the right trade.
3. **Sign everyone out.** All of these are hashed, so dropping the rows ends them:
   ```sh
   docker compose exec db psql -U lookout lookout -c "DELETE FROM sessions; DELETE FROM login_tokens; DELETE FROM extension_tokens;"
   ```
   Open invites live in `invites`; delete the unused ones too if invite links may have leaked.
4. **Rotate the keys.** For each one: make a new value, put it where it lives, then revoke the old one at the provider. Never paste a value into a ticket, chat or commit.

   | Key | Where it lives | Notes |
   | --- | --- | --- |
   | Model API key (OpenRouter) | admin page, or `AI_API_KEY` in `.env` | A key saved on the admin page wins over `.env`, so change it where it is set. The admin page shows its first and last 4 characters. Revoke the old key in the OpenRouter dashboard. |
   | Brave search key, if used | admin page, or `BRAVE_API_KEY` | Same rule as the model key. |
   | `SAM_API_KEY`, if set | `.env` | Make a new one at SAM.gov. |
   | `SMTP_URL`, if set | `.env` | Holds the mail password. Change it at the mail provider. |
   | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | `.env` | Make a new key and webhook secret in Resend. |
   | `ANTHROPIC_API_KEY`, if set | `.env` | |
   | `AGENT_TOKEN` | `.env` and Eric's Mac (`~/.config/lookout/agent.env`) | 32+ characters. Update both ends or Claude agent mode stops. |
   | Database password | `/opt/lookout/secrets/db_password` and `DATABASE_URL` in `.env` | Change it in Postgres first: `docker compose exec db psql -U lookout lookout`, then `\password lookout`, so the value stays out of shell history. Then both files. Use only letters and digits, or URL-encode it in `DATABASE_URL`. |
   | `APP_SECRET` | `.env` | Needs the extra steps below. |
   | SSH keys and server logins | `~/.ssh/authorized_keys` for root and every user | Remove any key you don't recognize. Rotate the `hermes_vps` deploy key. |

   **Changing `APP_SECRET`.** It encrypts the stored model and search keys, every person's EEO answers (`profiles.eeo`) and uploaded files, so those have to move to the new secret:
   1. In `.env`, set `APP_SECRET_PREVIOUS` to the old value and `APP_SECRET` to a new one (32+ characters).
   2. Run `docker compose run --rm app node scripts/reencrypt.mjs`. This starts a one-off container with the new `.env` and no open port, so it works while the app is stopped. It prints counts only. Running it twice is safe. "Unreadable" above 0 means something was on neither key; stop and look before going on.
   3. Remove `APP_SECRET_PREVIOUS` from `.env`.

   **After any `.env` change** use `docker compose up -d app`. `docker compose restart app` keeps the old environment.

5. **Restart** with `docker compose up -d app` (this is the Lookout stack in `/opt/lookout`, not Plane's), check `/api/health`, and sign in yourself to confirm.

## 3. First day: work out what happened

- What got in: the app, the database, the server, a provider account, or a key in a commit.
- When it started. Check app logs, `runs` and `events` timestamps, provider usage pages, and `last` / `journalctl` on the server.
- Whose data was reachable. Lookout keeps, per person: email and name, answers, resume and LinkedIn text, uploaded files, links, finds and notes, drafted applications, and EEO answers (encrypted). Uploaded files are in `DATA_DIR`. If the database or uploads were read, assume all of it for everyone.
- Was the hole closed? If not, fix it before turning the app back on for everyone.

## 4. Telling people

People hear it from us first, plainly: what happened, what of theirs was involved, what we did, and what they should do (for example, watch for phishing that uses their job search details).

- **Who:** everyone whose data was reachable. The list is the `users` table.
- **How:** email from Eric, one message per person, not a group thread.
- **When:** as fast as we can say something true, and within 30 days of finding it at the latest.

The legal part, for orientation only. Check it with a lawyer (#22) before sending anything:

- New York's SHIELD Act (General Business Law 899-aa) applies to New York residents. As amended in December 2024 it requires notice to affected people within 30 days of discovering a breach, plus notice to the NY Attorney General, the Department of State and the State Police. Notice to the credit reporting agencies is also needed if more than 5,000 New York residents are affected.
- Other states have their own laws, mostly with similar triggers and deadlines. Check each state where an affected person lives.
- Whether a law applies depends on what leaked. Some laws only count certain data (ID numbers, account numbers, sign-in credentials, health data). Resumes and EEO answers can include that kind of data, so assume notice is needed until the lawyer says otherwise.

## 5. Contacts

- **Owner and decision maker:** Eric Devlin.
- **Testers and users:** the `users` table (email).
- **Providers:** OpenRouter (model calls), Resend (email), AWS (Route 53 DNS, S3 backups), the VPS host, GitHub (code). Their security contacts: [Eric to fill in, or link the subprocessor list from #25]. Practice runs: #243.
- **Lawyer:** [Eric to fill in once #22 has one.]

## 6. After

- Write a short postmortem in a GitHub issue labeled `security`: timeline, cause, what fixed it, what we'll change. No secrets or personal data in it.
- File issues for the changes and ship them the normal way.
- Re-read this plan and fix whatever was wrong or slow.

## Practice run

Once a year, and after any big change to how Lookout is hosted, walk through this plan on staging (`/opt/lookout-staging`, port 3201) with a made-up scenario. Time each step and fix what didn't work. A good first scenario: "OpenRouter emails that our key is being used from another country." Staging has no `backup.sh` of its own; run prod's with `LOOKOUT_DIR=/opt/lookout-staging`. Don't revoke real provider keys in a drill; make and revoke a spare one instead.

Log:

- 2026-11-07, desk check by Claude (VPS), #243. Read every command against the code and the staging setup; no commands run (no root). Fixed here: `restart` doesn't reload `.env`; re-encrypt needed the app running while step 2 stops it; admin-page keys override `.env`; `SAM_API_KEY` and `SMTP_URL` were missing; wrong path for the Mac's agent token; database password ended up in shell history; the incident backup could be overwritten by the nightly one; no short path for a single leaked key. Filed: #274 (unreadable saved key falls back to .env silently), #275 (no way to run the staging commands without root). Still to do: a timed run on staging.
