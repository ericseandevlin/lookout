# Lookout

A personal search agent. Each user answers five questions and uploads a resume. On their schedule, Lookout searches the web with Claude, scores each posting against the profile, and adds matches to a board ("Finds") where they pin, archive, take notes and move roles through stages.

Jobs are the first opportunity type. Type-specific pieces live in `src/lib/kinds` so other types (RFPs next) can reuse the same engine. See [ROADMAP.md](ROADMAP.md).

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Postgres with Drizzle ORM; migrations in `drizzle/`, applied on server start
- Claude API (`@anthropic-ai/sdk`): web search + web fetch for discovery, structured outputs for scoring and resume extraction
- Email magic-link auth with DB sessions; email via any SMTP provider (nodemailer)
- Docker Compose on a VPS behind Caddy

## How discovery works

1. `src/lib/agent/discover.ts` builds a brief from the profile, resume summary and links.
2. A research call with `web_search` and `web_fetch` finds 8 to 15 open postings (skipping ones already on the board).
3. A second call turns the research into structured finds with a 1 to 5 score and short reasons.
4. `src/lib/agent/rules.ts` applies hard rules on top: below the comp floor caps at 3, outside preferred locations caps at 3, dealbreakers are dropped, missing comp is noted but not penalized.
5. New finds are deduped by URL and a company/title/location fingerprint, then inserted with a green "new" dot.

`src/lib/scheduler.ts` runs every 10 minutes inside the server, under a Postgres advisory lock. A user is due when their profile and resume are done and it's their run day after 7am (`APP_TZ`). The first run happens as soon as setup is complete. Every Claude call is logged in `runs` with tokens and cost, and new work is refused once the daily caps are hit.

## Local development

```bash
docker run -d --name lookout-pg -e POSTGRES_USER=lookout -e POSTGRES_PASSWORD=lookout -e POSTGRES_DB=lookout -p 5433:5432 postgres:17-alpine
cp deploy/env.example .env.local   # then set DATABASE_URL=postgres://lookout:lookout@localhost:5433/lookout, APP_URL=http://localhost:3000, EMAIL_DEV_LOG=1, SCHEDULER=off
npm install
npm run dev
```

With `EMAIL_DEV_LOG=1` and no `SMTP_URL`, sign-in links print to the dev server log.

```bash
npm run typecheck
npm run lint
npm test
```

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `APP_URL` | Public origin; used in emails and for the same-origin check on writes |
| `ANTHROPIC_API_KEY` | Claude API key |
| `LOOKOUT_MODEL` | Model for all calls (default `claude-opus-5-5`) |
| `SIGNUP_MODE` | `open` (anyone) or `invite` (only existing users, `ALLOWED_EMAILS`, `ADMIN_EMAILS`) |
| `SMTP_URL`, `MAIL_FROM` | Outgoing email, e.g. `smtps://resend:KEY@smtp.resend.com:465` |
| `DAILY_BUDGET_USD`, `USER_DAILY_BUDGET_USD` | Rolling 24h spend caps |
| `APP_TZ` | Timezone for run days (default `America/New_York`) |
| `SCHEDULER` | Set to `off` to disable scheduled runs |
| `DATA_DIR` | Where uploaded resumes are stored |

## Deploy

`deploy/deploy.sh` builds a `linux/amd64` image, ships it over SSH, and restarts the Compose stack in `/opt/lookout`. The server needs `/opt/lookout/.env` (from `deploy/env.example`, mode 600) and `/opt/lookout/secrets/db_password`. Caddy proxies the domain to `172.17.0.1:3200` (`deploy/Caddyfile.snippet`).

Import a board from the old pauljobs JSON format:

```bash
npm run import-legacy -- someone@example.com rows.json
```

## Security notes

- Sign-in tokens and session IDs are stored only as SHA-256 hashes. Tokens are single use, expire in 15 minutes, and are redeemed by POST so mail scanners can't burn them.
- All writes require a same-origin `Origin` header; cookies are `HttpOnly`, `Secure`, `SameSite=Lax`.
- Uploads are checked by magic bytes, capped at 5 MB, stored outside the web root, and served with a sandbox CSP.
- Posting URLs are fetched by Claude's servers, not this server, so a pasted link can't reach the VPS's internal network.
- The container runs as a non-root user on a read-only filesystem; Postgres is only on the internal Compose network.
