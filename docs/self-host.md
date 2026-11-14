# Run it yourself in 5 minutes

Lookout runs on your own machine with Docker and your own AI key. Your profile, resume and finds stay in your Postgres. The only things that leave are search queries (through the bundled SearXNG) and model calls to the provider you pick.

You need Docker with Compose v2, about 2 GB of free memory for the first build, and an API key for a model (or Ollama running locally).

## 1. Get the code and write `.env`

```bash
git clone https://github.com/ericseandevlin/lookout.git
cd lookout
scripts/selfhost-env.sh you@example.com
```

The script copies `deploy/selfhost.env.example` to `.env`, fills in random secrets, and makes you the admin. It won't overwrite an `.env` that already exists.

## 2. Add your key

Open `.env` and set `AI_API_KEY`. The defaults point at OpenRouter with the cheap open model the hosted version uses ([why](decisions/README.md)). Other choices:

| Provider | Set in `.env` |
|---|---|
| OpenRouter, DeepInfra, Together, Groq | `AI_BASE_URL` to their OpenAI-compatible URL, `AI_MODEL`, `AI_API_KEY` |
| Anthropic | `AI_PROVIDER=anthropic`, `AI_MODEL`, `AI_API_KEY` |
| Ollama on this machine | `AI_BASE_URL=http://host.docker.internal:11434/v1`, `AI_MODEL` (one you've pulled), no key |

You can skip this step and set it all in **Admin > AI settings** after you sign in. Keys saved there are encrypted with `APP_SECRET`, and the app's settings win over `.env` once saved. Each provider has a Test button.

## 3. Start it

```bash
docker compose up -d --build
```

The first build takes a few minutes. Migrations run when the app starts. Check it's up:

```bash
curl -s http://localhost:3000/api/health
```

## 4. Sign in

Open http://localhost:3000 and enter the email you gave the script. There's no email server, so the sign-in link goes to the app log:

```bash
docker compose logs app | grep auth/verify
```

Or mint a link directly:

```bash
docker compose exec app node scripts/login-link.mjs you@example.com
```

Links work once. The one in the log expires after 15 minutes, a minted one after an hour.

## 5. First search

Answer the five questions on **Profile**, add your resume if you have one, then press **Search now** on **Finds**. The dark panel shows each step; the report after it says where posts dropped out and what to change.

## Day to day

- **Stop and start:** `docker compose stop`, `docker compose start`. Data lives in the `pg` and `data` volumes and survives both.
- **Update:** `git pull && docker compose up -d --build`.
- **Back up:** `docker compose exec db pg_dump -U lookout lookout > lookout.sql`. Uploaded files are in the `data` volume; they're encrypted with `APP_SECRET`, so keep `.env` with the backup.
- **Spend caps:** `DAILY_BUDGET_USD` and `USER_DAILY_BUDGET_USD` in `.env` (also in Admin). Searches are refused once a cap is hit.
- **Scheduled searches** run on each person's schedule from Settings. Set `SCHEDULER=off` in `.env` to only search when you press the button.
- **Invite someone:** Admin > Invites. They'll need real email to get the link, so set `SMTP_URL` and `MAIL_FROM` first and remove `EMAIL_DEV_LOG`.
- **Start over:** `docker compose down -v` deletes the database and uploads.

## Opening it to other people

The app listens on `127.0.0.1` only. Before anyone else uses it, put it behind a TLS proxy (Caddy, nginx, Cloudflare Tunnel), set `APP_URL` to the public `https://` address so sign-in cookies are marked secure, and set up SMTP. `deploy/docker-compose.yml` and the Deploy section of the [README](../README.md#deploy) show how the hosted version runs.

## When something's off

- **"Missing required env var DATABASE_URL" or a Compose error about `POSTGRES_PASSWORD`:** `.env` is missing. Run step 1.
- **No sign-in link in the log:** check you typed the same email as `ADMIN_EMAILS`. In invite mode, other emails are refused.
- **Searches finish with nothing found:** open **See search report**. Zero results usually means SearXNG's upstream engines are rate-limiting you; try again later or set `SEARCH_PROVIDER=brave` with a `BRAVE_API_KEY`. Model errors show on **Admin > Errors**.
- **Saved key "can't be read":** `APP_SECRET` changed. Put the old one back, or re-enter the key in Admin > AI settings.
