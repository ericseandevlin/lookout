# Code map

Where things live in Lookout, and how a request moves through them. For what the product does, see the [README](../README.md); for each user flow as a diagram, see [flows.md](flows.md); for how to send a change, see [CONTRIBUTING](../CONTRIBUTING.md).

## The shape of it

One Next.js app (App Router) and one Postgres database. There is no separate API server or job queue: routes, the scheduler and the auto-apply pipeline all run in the app process.

```
browser ── src/proxy.ts ── src/app/(app)/layout.tsx ── getState() ── StoreProvider ── page components
   │                                                                     │
   └──────────────── /api/* routes (authed / adminRoute / publicRoute) ──┘
                                │
                           src/lib/*  ── Drizzle ── Postgres
                                │
                  AI (src/lib/ai), web search (SearXNG), email (SMTP, Resend)
```

## A request, end to end

1. **`src/proxy.ts`** (Next's middleware) gives every page a fresh CSP nonce and bounces signed-out visitors away from app pages. It is an optimistic gate only; the real session check comes next.
2. **`src/app/(app)/layout.tsx`** checks the session (`src/lib/auth/session.ts`), sends people to `/welcome` or `/consent` when they owe a step, then loads everything the app shows with `getState()` (`src/lib/state.ts`): the active search, its board, profile, materials and latest run.
3. **`src/components/store.tsx`** holds that state on the client. Pages under `src/app/(app)/` are thin: each renders one component from `src/components/` that reads the store. After a change, the store refetches `/api/state`; only the newest answer is applied, so a late, older one can't empty the board. While a search runs it polls progress.
4. **API routes** in `src/app/api/` wrap their handlers with a helper from `src/lib/api.ts`:
   - `authed`: same-origin check on writes, session required, session slid forward, errors turned into JSON.
   - `adminRoute`: the same, admins only.
   - `publicRoute`: same-origin check and uniform errors, no session.
   Request bodies are parsed with zod through `body(req, schema)`. Throw `HttpError(status, message)` for an expected failure; anything else is logged to Admin > Errors (`src/lib/errorLog.ts`) and answered with a 500.
5. **`src/lib/`** does the work and talks to Postgres through Drizzle (`src/lib/db`).

Errors Next catches on its own (page renders, unwrapped routes) reach Admin > Errors through `src/instrumentation.ts`, which also applies migrations on start.

## Directories

| Path | What's there |
|---|---|
| `src/app/(app)/` | Signed-in pages: finds, events, profile, settings, apply, admin. |
| `src/app/api/` | JSON routes. `agent/` is for Claude agent mode, `ext/` for the browser extension, `inbound/` for received email. |
| `src/app/go/` | Tracked links from the finds email. |
| `src/components/` | React components, one per page plus folders for the finds board, admin, events and the auto-apply review. |
| `src/lib/db/` | `schema.ts` (every table), the client, and the migration runner. Migrations live in `drizzle/`. |
| `src/lib/auth/` | Magic-link sessions and the encryption used for stored keys and sensitive fields. |
| `src/lib/agent/` | Discovery: search profile, queries, picking, reading, scoring, rules, the search report, link reading, resume parsing, RFPs from SAM.gov, networking events. Entry point: `discover.ts`. |
| `src/lib/ai/` | The model client (`llm.ts`, structured calls checked with zod, zero-retention routing), web search, the page fetcher with its address checks, run logging and spend caps. |
| `src/lib/kinds/` | Everything specific to an opportunity type (questions, copy, columns, stages, the discovery brief). Add a new type here. |
| `src/lib/application/` | Auto-apply (staging only): scan a posting, draft the resume and cover letter, fill the form plan, review, submit. Entry point: `run.ts`. See [auto-apply.md](auto-apply.md). |
| `src/lib/extension/` | Bearer tokens and posting matching for the Firefox extension in `extension/firefox`. |
| `src/lib/inbound/` | Email received at the app's domain. Treated as untrusted data. |
| `src/lib/` (top level) | Smaller pieces: the scheduler, digest email, config (env defaults plus admin overrides), feature switches, retention cleanup, metrics, surveys, consent and legal versions. |
| `scripts/` | One-off and dev tools: demo seed, login link, re-encryption, CI report, uptime check. |
| `deploy/` | Compose file, env examples, Caddy snippet, deploy, backup and restore-drill scripts. See [self-host.md](self-host.md). |
| `test/` | Test fixtures and the `server-only` stub. Tests sit next to the code they cover (`*.test.ts`). |

## Background work

- **Scheduler** (`src/lib/scheduler.ts`): ticks every 10 minutes under a Postgres advisory lock, so only one app instance runs it. Each pass runs the daily cleanup (`src/lib/retention.ts`) when it's due, closes out runs a restart orphaned, sweeps auto-apply work left behind, then starts due searches and sends each person's digest after their search.
- **Search runs** report progress steps that the live panel on the board polls. Spend caps in `src/lib/ai/runs.ts` refuse new AI work once the daily total is hit.
- **Claude agent mode**: runs are queued instead of run in process, and a worker outside the app picks them up through `/api/agent/*` with a bearer token.

## Switches and config

- **Env vars** are listed in the README under Configuration; a test fails if the server reads one that has no row there.
- **Admin settings** (`src/lib/config.ts`) override env defaults at runtime. API keys saved there are stored encrypted.
- **Feature switches** (`src/lib/features.ts`) keep staging-only features off unless the server's env turns them on.

## Tests

Vitest, in the Node environment (`vitest.config.mts`). `@/` maps to `src/`. Most route and store tests mock `@/lib/db`, so `npm test` needs no database. `npm run test:coverage` is what CI runs, with a coverage floor that only goes up.

## Where to start

- **A new field on the profile or a find**: `src/lib/db/schema.ts`, then `npx drizzle-kit generate`, then the type in `src/lib/types.ts`, `getState()` and the component.
- **A change to how searches score or filter**: `src/lib/agent/rules.ts` for hard rules, `src/lib/kinds` for the brief the model gets.
- **A new API route**: copy a nearby `route.ts`, wrap it in `authed` or `adminRoute`, parse the body with zod, and add a `route.test.ts` beside it.
- **A new opportunity type**: `src/lib/kinds/index.ts`, plus a discovery source if it isn't web search (see `src/lib/agent/rfp.ts`).
