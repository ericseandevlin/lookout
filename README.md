# Lookout

[![CI](https://github.com/ericseandevlin/lookout/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ericseandevlin/lookout/actions/workflows/ci.yml)

A personal search agent. Each person answers five questions and adds their resume, LinkedIn PDF and links. On their schedule, Lookout searches the web, reads the postings, scores each one against their profile, and puts the matches on a board ("Finds"). There they pin, archive, take notes, move roles through stages, and mark things "Not a fit" so later searches learn.

Why it exists: I built it for my own job search. An agent read the postings and scored them against me, and it worked well enough that friends asked if they could use it too. So it turned into an app where each person gets their own profile and their own search. - Eric

Jobs are the first opportunity type. Type-specific pieces live in `src/lib/kinds` so other types (RFPs next) can reuse the engine. See [ROADMAP.md](ROADMAP.md) for what's next and [CHANGELOG.md](CHANGELOG.md) for every release. Live at https://lookout.ericdevlin.co (alias: paulfinds.pauljustinscott.com). Invite only.

![Opening a find from the board and closing it again.](docs/screenshots/hero.gif)

![The Finds board: eight roles scored 1 to 5 against the profile, with pay, stage and location.](docs/screenshots/finds-board.png)

![A find opened: why it's a match, the stage picker and notes.](docs/screenshots/find-detail.png)

Screenshots use a made-up demo account; no real user data. The Screenshots workflow redraws them: run it from the Actions tab and copy its artifact into `docs/screenshots`.

## Stack

- Next.js 16 (App Router, `src/proxy.ts` as middleware), React 19, TypeScript
- Postgres 17 with Drizzle ORM; migrations in `drizzle/`, applied on server start (`instrumentation.ts`)
- AI: any OpenAI-compatible API (OpenRouter today, model `deepseek/deepseek-v4.1-flash`), Anthropic, or a queue worked by Claude Code on Eric's Mac ("Claude agent" mode). Chosen in Admin > AI settings; keys stored encrypted.
- Web search: self-hosted SearXNG (Compose service `searxng`); Brave Search API optional
- Email: magic links and invites over SMTP (Resend, from `lookout@ericdevlin.co`)
- Docker Compose on a Hostinger VPS behind Caddy

## Product, page by page

- **Sign in / Request access** (`/`): email magic link only. In invite mode, strangers can request access by email plus one multiple-choice question; admins approve.
- **Welcome** (`/welcome`): first sign-in quick picks (salary range, work mode) that prefill the profile.
- **Finds** (`/finds`): the board. Header has **Search now**, **Add** (paste a posting link), and **See search report** for the last search. A dark panel shows live search progress and, after a search, a report: searches, results, pages read, job posts, added; where posts dropped out (already on board, dealbreaker, under pay floor, off on location); up to two tips that link to the field to change; and the queries it ran. The detail drawer has stages, notes, and **Not a fit** with a reason.
- **Events** (`/events`): networking events (meetups, panels, conferences, talks) the search finds for your interests, nearby or online, on their own list. Set interests there; empty means no event search. Event searches ride along with a job search weekly or monthly (your pick), or run now with Search now. Each event gets a 1 to 5 fit and rough distance; pinned events survive Clear, which archives the rest. Past events drop off.
- **Profile** (`/profile`), three tabs:
  - **Your answers**: the five questions, with starter chips on Q1 (step-up phrases), Q4 (sentence starters) and Q5 (common dealbreakers).
  - **Materials** (`/profile/materials`): resume (PDF/DOCX, fills empty answers), LinkedIn PDF (LinkedIn has no usable API and blocks scraping, so people use its Save to PDF; steps are on the page), and other links, which Lookout reads and shows as Read / why it couldn't.
  - **What Lookout sees** (`/profile/sees`): the saved search profile every search uses, with links to edit each part and a Rebuild button.
- **Settings** (`/settings`): schedule, digest, density, name, change email, signed-in devices, export, reset board, delete everything, privacy link.
- **Admin** (`/admin`, admins only): people, access mode, spend caps, access requests, invites (with Resend and copy link), recent runs. **AI settings** (`/admin/ai`): provider presets (OpenRouter, OpenCode Zen/Go, DeepInfra, Together, Groq, Ollama, Custom), model pickers, encrypted keys, Test buttons. Everything autosaves. **Metrics** (`/admin/metrics`): the beta goals from ROADMAP > Goals (weekly actives, finds acted on per active person, interviews, week-4 retention, cost per active person) and where each stands. **Errors** (`/admin/errors`): server errors Lookout recorded, newest first, with search (#12).
- **Privacy** (`/privacy`): what's kept, who sees it, services used, controls.

## How a search works

`src/lib/agent/discover.ts`, built to work with small, cheap models:

![A person answers five questions. Lookout writes queries, searches the web with SearXNG, reads each posting, scores it against the profile and rules, and puts matches on the Finds board.](docs/search-flow.svg)

1. **Search profile.** `src/lib/agent/searchProfile.ts` builds a compact profile (summary, target titles, level, industries, strengths, results, where, pay, rules-out, keywords) from the answers, resume text, LinkedIn PDF text and link text. It's stored on `profiles.search_profile` with a hash of its inputs and rebuilt only when they change. Without a model it falls back to sending the raw text.
2. **Queries.** The model writes 4 to 6 search queries.
3. **Search.** SearXNG runs them; results are deduped against the board and job aggregators.
4. **Pick.** The model picks up to 15 likely single postings (falls back to the top results if its answer is bad).
5. **Read.** `src/lib/ai/fetchPage.ts` fetches each page itself: private, loopback and metadata addresses are refused at connect time, ports 80/443 only, redirects re-checked, 2 MB cap. Text and schema.org `JobPosting` data are extracted.
6. **Score.** The model scores pages four at a time against the profile, plus the user's last 12 "Not a fit" reasons.
7. **Rules.** `src/lib/agent/rules.ts`: dealbreakers are dropped; under the pay floor or off on location caps the score at 3; missing comp is noted.
8. **Save and report.** New finds are deduped by URL and a company/title/location fingerprint. The run stores a tally and tips (`src/lib/agent/report.ts`) in `runs.report`.

`src/lib/scheduler.ts` ticks every 10 minutes under a Postgres advisory lock and starts due users' searches. Every run logs tokens, searches and cost; daily caps (global and per user) refuse new work once hit. In Claude agent mode, runs are queued and `~/Life-OS/scripts/lookout/poll.sh` (launchd, every 2 minutes) has Claude Code work them through `/api/agent/*` with a bearer token.

Why it's built this way (open models, zero-retention routing, rules in code, staging first): [docs/decisions](docs/decisions/README.md).

Where the code lives and how a request flows through it: [docs/architecture.md](docs/architecture.md).

## Run it yourself

Docker and your own AI key, about five minutes:

```bash
git clone https://github.com/ericseandevlin/lookout.git && cd lookout
scripts/selfhost-env.sh you@example.com   # writes .env with random secrets; add AI_API_KEY there or later in Admin
docker compose up -d --build
docker compose logs app | grep auth/verify   # after you enter your email at http://localhost:3000
```

Providers, backups, updates and opening it to others: [docs/self-host.md](docs/self-host.md).

## Local development

```bash
docker run -d --name lookout-pg -e POSTGRES_USER=lookout -e POSTGRES_PASSWORD=lookout -e POSTGRES_DB=lookout -p 5433:5432 postgres:17-alpine
cp deploy/env.example .env.local   # set DATABASE_URL=postgres://lookout:lookout@localhost:5433/lookout, APP_URL=http://localhost:3000, EMAIL_DEV_LOG=1, SCHEDULER=off
npm install
npm run dev
```

With `EMAIL_DEV_LOG=1` and no `SMTP_URL`, sign-in links print to the dev server log. Or mint one: `node scripts/login-link.mjs you@example.com` (with `.env.local` loaded).

To see a full board without an AI key, `npm run seed:demo` creates the made-up account from the screenshots (Maya Ortiz, demo@example.com, eight finds). Re-running it rebuilds the account. Then `npm run login-link demo@example.com` to sign in as her.

```bash
npm run typecheck
npm run lint
npm test
npx drizzle-kit generate --name what_changed   # after editing src/lib/db/schema.ts
```

## Configuration

AI and search settings can live in env or be set in Admin > AI settings (the database wins once saved).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `APP_URL` | Public origin; used in emails and the same-origin check on writes |
| `EXTRA_ORIGINS` | Other origins allowed to write (e.g. the paulfinds alias) |
| `APP_SECRET` | 32+ chars; encrypts API keys, EEO answers and uploaded files |
| `APP_SECRET_PREVIOUS` | Only while changing `APP_SECRET`: the old value, so stored secrets stay readable until `scripts/reencrypt.mjs` moves them |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_PRICE_IN`, `AI_PRICE_OUT`, `AI_JSON_MODE` | Default model settings (`openai`, `anthropic` or `agent`) |
| `ANTHROPIC_API_KEY` | Used as the key when `AI_PROVIDER=anthropic` and `AI_API_KEY` is empty |
| `AGENT_TOKEN` | 32+ chars; bearer token for the Claude agent queue |
| `AGENT_ERRORS_TOKEN` | 32+ chars; staging only. Lets agents read server errors at `GET /api/agent/errors?since=<ISO>` (#486). Unset on prod, where the route is a 404 and errors stay in Admin > Errors |
| `SEARCH_PROVIDER`, `SEARXNG_URL`, `BRAVE_API_KEY`, `SEARCH_PRICE` | Web search |
| `SAM_API_KEY` | Free key from a SAM.gov account; turns on RFP searches (federal solicitations). RFP search stays off without it |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile keys; with both set, Request access shows a bot check and the server verifies it (#13). Off without them |
| `SIGNUP_MODE` | `invite` (default) or `open` |
| `ADMIN_EMAILS`, `ALLOWED_EMAILS` | Comma lists; admins can always sign in |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email, e.g. `smtps://resend:KEY@smtp.resend.com:465`. The From address only sends |
| `MAIL_POSTAL_ADDRESS` | Postal address in the footer of the finds email and of news and waitlist mail (#28). News and waitlist mail won't send without it. Rules: `docs/email-rules.md` |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | Incoming email at lookout.ericdevlin.co (#178): a Resend key that can read received email (the SMTP key only sends) and the `whsec_` secret of the email.received webhook pointed at `/api/inbound/resend`. Agents read new mail at `/api/agent/inbox` with `AGENT_TOKEN` |
| `MAIL_REPLY_TO` | Where replies go (default: the first `ADMIN_EMAILS` address) |
| `DAILY_BUDGET_USD`, `USER_DAILY_BUDGET_USD` | Rolling 24h spend caps (also editable in Admin) |
| `APP_TZ` | Timezone for run days (default `America/New_York`) |
| `SCHEDULER` | `off` disables scheduled runs |
| `FEATURE_AUTO_APPLY` | `on` shows auto-apply to admins (staging only until released) |
| `FEATURE_AUTO_SUBMIT` | `on` lets auto-apply press Submit itself; otherwise it fills the form and stops for review |
| `FEATURE_EVENTS` | `on` shows the Events page and adds event searches to scheduled runs (staging only until released) |
| `FEATURE_SEARCHES` | `on` allows more than one search per account and shows the kind picker at sign-up (staging only until released) |
| `CHROMIUM_PATH` | Chromium used by auto-apply (default `/usr/bin/chromium-browser`, set in the Docker image) |
| `MIGRATIONS_DIR` | Database migrations folder (default `./drizzle`, set in the Docker image) |
| `GIT_COMMIT` | Build arg; the commit `/api/health` reports. `deploy/deploy.sh` sets it |
| `DATA_DIR` | Where uploads are stored |
| `EMAIL_DEV_LOG` | `1` prints emails to the log instead of sending |

## How we work

Contributing? Start with [CONTRIBUTING.md](CONTRIBUTING.md). Security problems go to [SECURITY.md](SECURITY.md), not an issue.

- Every change starts as a GitHub issue. Branch from `main` as `feat/<issue>-<slug>` or `fix/<issue>-<slug>` (chores: `chore/...`).
- Every commit message names its issue, e.g. `Drawer: previous/next on the edge (#48)`. One branch per issue; don't mix work.
- Open a PR into `main`. CI runs on every PR: typecheck, lint, tests, a dependency audit (high severity), Semgrep and a gitleaks secret scan (`.github/workflows/ci.yml`). Merge only when it's green. PRs that change only Markdown or `docs/` (not README.md) skip CI to save Actions minutes. Dependabot opens weekly update PRs. Merging deploys to staging; review happens on staging, not in the PR.
- `prod` moves only at the weekly release meeting, by fast-forward to an approved `main` commit.
- Every release gets a version (`vX.Y.Z`, Semantic Versioning: minor for features, patch for fixes and hotfixes), a section in [CHANGELOG.md](CHANGELOG.md), a git tag and a GitHub Release with the same notes. Unreleased work collects under "Unreleased".
- Hooks enforce this (run once per clone: `git config core.hooksPath .githooks`): no commits directly on `main` or `prod`, no commit without an issue number.

## Deploy

Three environments, promoted in order: **dev** is your machine (`npm run dev`, feature branches), **staging** is branch `main` (`deploy/deploy.sh staging`), **production** is branch `prod` (`deploy/deploy.sh`). Changes reach production only after review on staging at the weekly release meeting: `git checkout prod && git merge --ff-only <approved commit> && git push`, then deploy. The script refuses to deploy from the wrong branch, with uncommitted changes, or with unpushed commits, and labels each image with its commit.


**From CI (#18, rolling out).** A push to `release/stage` or `release/prod` runs `.github/workflows/release.yml`: the same checks as CI, then the image is built in GitHub Actions, scanned with Trivy (high and critical findings in the run summary, a CycloneDX SBOM as an artifact, fails on fixable critical ones), and pushed to the private registry as `ghcr.io/ericseandevlin/lookout:sha-<commit>` plus `:stage` or `:prod`. The VPS pulls on its own: root cron runs `deploy/pull-deploy.sh stage|prod` every two minutes, which deploys a new image, checks `/api/health` and rolls back to the previous image if it fails. GitHub holds no key to the server; the server holds a read-only registry token. Promote to staging with `git push origin main:release/stage`. Install the server side once with `deploy/install-pull-deploy.sh` (as root, after a read-only `docker login` into `/root/.config/lookout-ghcr`; steps in its header). It covers staging only. Until it is installed, staging deploys with `sudo /root/bin/lookout-deploy-staging`; after, use `git push origin origin/main:release/stage` instead, or the two will undo each other. Production deploys as below.

**Deploy visibility (#292).** `/api/health` returns the running commit (`{"ok":true,"commit":"abc1234"}`; `null` if the image was built without `--build-arg GIT_COMMIT`). Every deploy, rollback or failed deploy by `pull-deploy.sh` appends one line to `/opt/lookout-staging/DEPLOYS.txt` (both channels, readable by everyone on the server): time, channel, what happened, the new and previous commit, the health answer and a link to the Release run with the image scan, e.g. `2026-11-07T07:00:00Z stage deployed abc1234 (was def5678), health={"ok":true,"commit":"abc1234"} scan=https://github.com/ericseandevlin/lookout/actions/runs/123`. To also post it somewhere (for example a Paperclip comment), set `LOOKOUT_DEPLOY_NOTIFY` in the cron line to an executable that reads the line on stdin; it stays on the server and a failing notifier never fails the deploy.

`deploy/deploy.sh` builds a `linux/amd64` image, ships it over SSH (`hermes_vps` key), copies the Compose file, SearXNG settings and backup script, installs the backup cron, restarts the stack in `/opt/lookout`, and checks `/api/health`. The server needs `/opt/lookout/.env` (from `deploy/env.example`, mode 600) and `/opt/lookout/secrets/db_password`. The app listens on `172.17.0.1:3200`; Caddy in Plane's proxy container (`/root/Caddyfile.proper`) serves both domains. DNS for ericdevlin.co is Route 53.

Sign someone in without email (on the server): `docker compose exec app node scripts/login-link.mjs someone@example.com`.

## Uptime and errors

- **Uptime:** `.github/workflows/uptime.yml` calls `/api/health` on prod and staging every 5 minutes from GitHub (best effort, so sometimes 15). Three failures 30 seconds apart open an issue labeled `outage`, which GitHub emails; it closes itself when the site answers. From 10pm to 7am New York nothing is opened or closed; the first check after 7am opens one "was down overnight" issue instead. Logic: `scripts/uptime-check.sh`. Run it by hand from Actions > Uptime > Run workflow.
- **Errors:** unexpected server errors (API 500s, pages that crash, scheduler failures) are stored in the `server_errors` table and searchable in Admin > Errors (`/admin/errors`). Paths are stored without the query string; rows are kept 30 days.

## Backups

- **Server:** root cron at 07:15 UTC runs `/opt/lookout/backup.sh`: `pg_dump` of the whole database (13 tables: the 12 app tables plus Drizzle's migration log) and a tarball of uploaded files (encrypted with `APP_SECRET`, so a restore needs the same secret), into `/opt/lookout/backups`, kept 14 days. Log: `/opt/lookout/backups.log`.
- **Off server:** Eric's Mac runs `~/Life-OS/scripts/lookout/pull-backup.sh` daily at 9:30 (launchd `co.ericdevlin.lookout-backup`, catches up on wake). It copies the backups to `~/Backups/lookout` (30 days) and uploads an encrypted copy to `s3://eric-site-backups/lookout` (60 days). Log: `~/Library/Logs/lookout-backup.log`.
- **Key:** `~/.config/lookout/backup.key` (also in 1Password). Without it the S3 copies can't be read.
- **Restore:**
  ```bash
  openssl enc -d -aes-256-cbc -pbkdf2 -pass file:$HOME/.config/lookout/backup.key -in db-YYYYMMDD.dump.enc -out db.dump
  pg_restore --clean --if-exists -d "$DATABASE_URL" db.dump
  # files-YYYYMMDD.tgz unpacks to /opt/lookout/data
  ```
  Tested 2026-10-11: downloaded, decrypted and listed all 13 tables.

## Security notes

- Retention (`src/lib/retention.ts`, daily from the scheduler): expired sign-in links and sessions are deleted; run logs, reports and requests older than 12 months are cleared, keeping the run counts and cost; server errors older than 30 days are deleted.
- Sign-in tokens and session IDs are stored only as SHA-256 hashes. Tokens are single use, expire in 15 minutes (invites 7 days), and are redeemed by POST so mail scanners can't burn them. Sessions roll for 90 days.
- All writes require a same-origin `Origin` header; cookies are `HttpOnly`, `Secure`, `SameSite=Lax`. In-memory rate limits on sign-in, uploads and rebuilds.
- API keys in the database are encrypted with AES-256-GCM keyed from `APP_SECRET`; the admin UI only ever shows the last four characters.
- Uploads are checked by magic bytes, capped at 5 MB, encrypted at rest (AES-256-GCM keyed from `APP_SECRET`), stored outside the web root, and served with a sandbox CSP. Files saved before encryption still read; `node scripts/reencrypt.mjs` in the app container encrypts them.
- Pages the app fetches go through an SSRF-safe fetcher (see step 5 above). Fetched pages are untrusted input; model output is schema-bound and never executed.
- The container runs as a non-root user on a read-only filesystem; Postgres is only on the internal Compose network.
- Open items are tracked as GitHub issues labeled `security`, `hardening`, `accessibility` and `code-quality`.

## License

Copyright (C) 2026 Eric Devlin. Lookout is free software under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). Use it, change it and run it yourself. If you run a changed version as a service for other people, you have to offer them its source too. Why AGPL and not MIT: [docs/decisions](docs/decisions/README.md#7-agpl-30-license-2026-11-08).
